import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memories, memoryConnections, memoryImplications, memorySyncState, provocations } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { processMemories } from "@/lib/memory/pipeline";
import { consolidateMemories } from "@/lib/memory/consolidate";
import { generateProvocationsForUser } from "@/lib/memory/provoke";
import { abstractMemory } from "@/lib/memory/abstract";
import { embedSingle } from "@/lib/memory/embed";

export const maxDuration = 300; // Vercel Hobby with fluid compute allows up to 300s

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse options from request body
  let limit = 1;
  let reset = false;
  let clean = false;
  let abstractOnly = false;
  let consolidationClean = false;
  let reconsolidate = false;
  let regenerateProvocations = false;
  try {
    const body = await request.json();
    if (body.limit && typeof body.limit === "number") limit = body.limit;
    if (body.reset) reset = true;
    if (body.clean) clean = true;
    if (body.abstractOnly) abstractOnly = true;
    if (body.consolidationClean) consolidationClean = true;
    if (body.reconsolidate) reconsolidate = true;
    if (body.regenerateProvocations) regenerateProvocations = true;
  } catch {
    // No body or invalid JSON — use defaults
  }

  // Consolidation clean mode: wipe all connections + implications, optionally reconsolidate
  if (consolidationClean) {
    const deletedConnections = await db
      .delete(memoryConnections)
      .where(eq(memoryConnections.userId, userId))
      .returning({ id: memoryConnections.id });

    const deletedImplications = await db
      .delete(memoryImplications)
      .where(eq(memoryImplications.userId, userId))
      .returning({ id: memoryImplications.id });

    console.log(
      `[backfill] Cleaned ${deletedConnections.length} connections and ${deletedImplications.length} implications for user ${userId}`
    );

    let consolidationResult = null;
    if (reconsolidate) {
      try {
        consolidationResult = await consolidateMemories(userId, { timeoutMs: 240_000 });
        console.log(`[backfill] Reconsolidation complete:`, consolidationResult);
      } catch (error) {
        console.error(`[backfill] Reconsolidation failed:`, error);
        return NextResponse.json({
          success: true,
          consolidationClean: true,
          deletedConnections: deletedConnections.length,
          deletedImplications: deletedImplications.length,
          reconsolidation: {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      consolidationClean: true,
      deletedConnections: deletedConnections.length,
      deletedImplications: deletedImplications.length,
      ...(consolidationResult ? { reconsolidation: { success: true, ...consolidationResult } } : {}),
    });
  }

  // Regenerate provocations: delete today's provocations, then regenerate
  if (regenerateProvocations) {
    const today = new Date().toISOString().slice(0, 10);
    const deleted = await db
      .delete(provocations)
      .where(and(eq(provocations.userId, userId), eq(provocations.date, today)))
      .returning({ id: provocations.id });

    console.log(`[backfill] Deleted ${deleted.length} provocations for ${today}`);

    try {
      const result = await generateProvocationsForUser(userId);
      return NextResponse.json({
        success: true,
        regenerateProvocations: true,
        deletedProvocations: deleted.length,
        generated: result.generated,
        errors: result.errors,
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        regenerateProvocations: true,
        deletedProvocations: deleted.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Abstract-only mode: generate abstract embeddings for memories that don't have them
  if (abstractOnly) {
    // If reset flag is also set, clear all abstract embeddings (including zero-vectors) first
    if (reset) {
      await db.execute(
        sql`UPDATE memories SET abstract_embedding = NULL WHERE user_id = ${userId}`
      );
      console.log(`[backfill-abstract] Reset all abstract embeddings for user ${userId}`);
    }

    const batchSize = limit > 1 ? limit : 1; // use limit=30 once debugged
    const missing = await db
      .select({ id: memories.id, content: memories.content })
      .from(memories)
      .where(
        sql`${memories.userId} = ${userId} AND ${memories.abstractEmbedding} IS NULL AND ${memories.embedding} IS NOT NULL`
      )
      .limit(batchSize);

    let processed = 0;
    let failed = 0;
    const failedIds: string[] = [];
    let firstError: string | null = null;

    // Process in serial batches of 3 to avoid rate limits
    for (let i = 0; i < missing.length; i += 3) {
      const batch = missing.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (mem) => {
          try {
            const abstractText = await abstractMemory(mem.content);
            const abstractEmb = await embedSingle(abstractText);
            await db
              .update(memories)
              .set({ abstractEmbedding: abstractEmb })
              .where(eq(memories.id, mem.id));
            return { success: true, id: mem.id, error: null };
          } catch (err) {
            return { success: false, id: mem.id, error: err instanceof Error ? err.message : String(err) };
          }
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.success) {
          processed++;
        } else {
          failed++;
          if (r.status === "fulfilled") {
            failedIds.push(r.value.id);
            if (!firstError) firstError = r.value.error;
          } else {
            if (!firstError) firstError = String(r.reason);
          }
        }
      }
    }

    // Mark permanently-failed memories so they don't block future batches.
    // Disabled during debugging — re-enable once root cause is found.
    // if (failedIds.length > 0) {
    //   const zeroVec = new Array(1024).fill(0);
    //   await db
    //     .update(memories)
    //     .set({ abstractEmbedding: zeroVec })
    //     .where(sql`${memories.id} IN ${failedIds}`);
    // }

    const remaining = await db.execute(
      sql`SELECT COUNT(*) as count FROM memories WHERE user_id = ${userId} AND abstract_embedding IS NULL AND embedding IS NOT NULL`
    );
    const remainingCount = parseInt(
      (remaining.rows[0] as { count: string }).count,
      10
    );

    return NextResponse.json({
      success: true,
      abstractOnly: true,
      processed,
      failed,
      remaining: remainingCount,
      firstError,
    });
  }

  // If clean, delete ALL existing memories for this user
  if (clean) {
    const deleted = await db
      .delete(memories)
      .where(eq(memories.userId, userId))
      .returning({ id: memories.id });
    console.log(
      `[memory-backfill] Cleaned ${deleted.length} existing memories for user ${userId}`
    );
    // Clean implies reset — also clear sync state
    reset = true;
  }

  // If reset, clear sync state to force reprocessing of ALL files
  if (reset) {
    await db
      .delete(memorySyncState)
      .where(eq(memorySyncState.userId, userId));
    console.log(`[memory-backfill] Reset sync state for user ${userId}`);
  }

  const result = await processMemories(userId, { limit });

  return NextResponse.json({
    success: true,
    ...result,
  });
}
