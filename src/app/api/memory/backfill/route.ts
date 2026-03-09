import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  memories,
  memoryConnections,
  memoryImplications,
  memorySyncState,
  provocations,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { processMemories } from "@/lib/memory/pipeline";
import { consolidateMemories } from "@/lib/memory/consolidate";
import { generateProvocationsForUser } from "@/lib/memory/provoke";
import { abstractMemory } from "@/lib/memory/abstract";
import { embedSingle } from "@/lib/memory/embed";
import { getDateStringInTimeZone } from "@/lib/timezone";
import { getUserTimeZone } from "@/lib/userTimeZone";

export const maxDuration = 300; // Vercel Hobby with fluid compute allows up to 300s

interface FullResetCounts {
  memoryImplications: number;
  memoryConnections: number;
  memoryClusters: number;
  provocations: number;
  memories: number;
  memorySyncState: number;
  consolidationDigests: number;
  total: number;
}

type SqlExecutor = {
  execute: (query: unknown) => Promise<{ rows: unknown[] }>;
};

const FULL_RESET_TABLES: Array<{
  key: keyof Omit<FullResetCounts, "total">;
  table: string;
}> = [
  { key: "memoryImplications", table: "memory_implications" },
  { key: "memoryConnections", table: "memory_connections" },
  { key: "memoryClusters", table: "memory_clusters" },
  { key: "provocations", table: "provocations" },
  { key: "memories", table: "memories" },
  { key: "memorySyncState", table: "memory_sync_state" },
  { key: "consolidationDigests", table: "consolidation_digests" },
];

function emptyResetCounts(): FullResetCounts {
  return {
    memoryImplications: 0,
    memoryConnections: 0,
    memoryClusters: 0,
    provocations: 0,
    memories: 0,
    memorySyncState: 0,
    consolidationDigests: 0,
    total: 0,
  };
}

function computeResetTotal(counts: FullResetCounts): number {
  return (
    counts.memoryImplications +
    counts.memoryConnections +
    counts.memoryClusters +
    counts.provocations +
    counts.memories +
    counts.memorySyncState +
    counts.consolidationDigests
  );
}

function parseCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

async function countRowsForTable(
  executor: SqlExecutor,
  table: string,
  userId: string
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COUNT(*)::int as count
    FROM ${sql.raw(table)}
    WHERE user_id = ${userId}
  `);
  return parseCount((result.rows[0] as { count?: unknown } | undefined)?.count);
}

async function deleteRowsForTable(
  executor: SqlExecutor,
  table: string,
  userId: string
): Promise<number> {
  const result = await executor.execute(sql`
    WITH deleted AS (
      DELETE FROM ${sql.raw(table)}
      WHERE user_id = ${userId}
      RETURNING 1
    )
    SELECT COUNT(*)::int as count FROM deleted
  `);
  return parseCount((result.rows[0] as { count?: unknown } | undefined)?.count);
}

async function previewFullDerivedReset(userId: string): Promise<FullResetCounts> {
  const counts = emptyResetCounts();
  for (const target of FULL_RESET_TABLES) {
    counts[target.key] = await countRowsForTable(db as unknown as SqlExecutor, target.table, userId);
  }
  counts.total = computeResetTotal(counts);
  return counts;
}

async function runFullDerivedReset(userId: string): Promise<FullResetCounts> {
  return db.transaction(async (tx) => {
    const counts = emptyResetCounts();
    for (const target of FULL_RESET_TABLES) {
      counts[target.key] = await deleteRowsForTable(
        tx as unknown as SqlExecutor,
        target.table,
        userId,
      );
    }
    counts.total = computeResetTotal(counts);
    return counts;
  });
}

async function regenerateTodayProvocations(userId: string): Promise<{
  date: string;
  timeZone: string;
  deleted: number;
  generated: number;
  errors: number;
}> {
  const timeZone = await getUserTimeZone(userId);
  const today = getDateStringInTimeZone(new Date(), timeZone);

  const deleted = await db
    .delete(provocations)
    .where(and(eq(provocations.userId, userId), eq(provocations.date, today)))
    .returning({ id: provocations.id });

  const generated = await generateProvocationsForUser(userId, {
    date: today,
    timeZone,
  });

  return {
    date: today,
    timeZone,
    deleted: deleted.length,
    generated: generated.generated,
    errors: generated.errors.length,
  };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse options from request body
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body or invalid JSON — use defaults
  }

  const limitRaw = typeof body.limit === "number" ? Math.floor(body.limit) : 1;
  let limit = Math.max(1, limitRaw);
  const reset = body.reset === true;
  const clean = body.clean === true;
  const abstractOnly = body.abstractOnly === true;
  const consolidationClean = body.consolidationClean === true;
  const reconsolidate = body.reconsolidate === true;
  const regenerateProvocations = body.regenerateProvocations === true;
  const fullDerivedReset = body.fullDerivedReset === true;
  const rebuildSemanticV2 = body.rebuildSemanticV2 === true;
  const dryRun = body.dryRun === true;

  // Full reset preview / execution (optionally chained with semantic v2 rebuild)
  if (fullDerivedReset || rebuildSemanticV2) {
    const resetPreview = await previewFullDerivedReset(userId);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        fullDerivedReset: fullDerivedReset || rebuildSemanticV2,
        rebuildSemanticV2,
        deletions: resetPreview,
        note: rebuildSemanticV2
          ? "Dry run only previews deletion counts. No rebuild work was executed."
          : undefined,
      });
    }

    const deleted = await runFullDerivedReset(userId);

    if (!rebuildSemanticV2) {
      return NextResponse.json({
        success: true,
        fullDerivedReset: true,
        deletions: deleted,
      });
    }

    // Rebuild semantic v2 memory graph in batched loops.
    const rebuildBatchLimit =
      typeof body.limit === "number" ? Math.max(1, limit) : 25;
    limit = rebuildBatchLimit;
    const hardDeadline = Date.now() + 270_000;
    const passSummaries: Array<{
      filesProcessed: number;
      memoriesCreated: number;
      memoriesReinforced: number;
      remaining: number;
    }> = [];

    let totalFilesProcessed = 0;
    let totalMemoriesCreated = 0;
    let totalMemoriesReinforced = 0;
    let remaining = 0;
    let passes = 0;

    while (passes < 50) {
      const timeLeft = hardDeadline - Date.now();
      if (timeLeft < 20_000) break;

      const pass = await processMemories(userId, {
        limit,
        deadlineMs: Math.max(20_000, Math.min(120_000, timeLeft - 8_000)),
      });

      passSummaries.push(pass);
      totalFilesProcessed += pass.filesProcessed;
      totalMemoriesCreated += pass.memoriesCreated;
      totalMemoriesReinforced += pass.memoriesReinforced;
      remaining = pass.remaining;
      passes++;

      if (remaining === 0) break;
      if (pass.filesProcessed === 0) break;
    }

    const rebuildComplete = remaining === 0;
    const shouldReconsolidate = body.reconsolidate === false ? false : true;
    const shouldRegenerateProvocations = body.regenerateProvocations === false ? false : true;

    let reconsolidationResult:
      | { success: true; [key: string]: unknown }
      | { success: false; error: string }
      | null = null;
    let provocationResult:
      | {
          success: true;
          date: string;
          timeZone: string;
          deletedProvocations: number;
          generated: number;
          errors: number;
        }
      | { success: false; error: string }
      | null = null;

    if (rebuildComplete && shouldReconsolidate) {
      try {
        const consolidation = await consolidateMemories(userId, { timeoutMs: 240_000 });
        reconsolidationResult = { success: true, ...consolidation };
      } catch (error) {
        reconsolidationResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (rebuildComplete && shouldRegenerateProvocations) {
      try {
        const provocation = await regenerateTodayProvocations(userId);
        provocationResult = {
          success: true,
          date: provocation.date,
          timeZone: provocation.timeZone,
          deletedProvocations: provocation.deleted,
          generated: provocation.generated,
          errors: provocation.errors,
        };
      } catch (error) {
        provocationResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return NextResponse.json({
      success: true,
      fullDerivedReset: true,
      rebuildSemanticV2: true,
      deletions: deleted,
      rebuild: {
        complete: rebuildComplete,
        needsAnotherRun: !rebuildComplete,
        passes,
        batchLimit: limit,
        filesProcessed: totalFilesProcessed,
        memoriesCreated: totalMemoriesCreated,
        memoriesReinforced: totalMemoriesReinforced,
        remaining,
        passSummaries,
      },
      reconsolidation: reconsolidationResult,
      provocationRegeneration: provocationResult,
    });
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
    try {
      const result = await regenerateTodayProvocations(userId);
      return NextResponse.json({
        success: true,
        regenerateProvocations: true,
        date: result.date,
        timeZone: result.timeZone,
        deletedProvocations: result.deleted,
        generated: result.generated,
        errors: result.errors,
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        regenerateProvocations: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Abstract-only mode: generate abstract embeddings for memories that don't have them
  if (abstractOnly) {
    // If reset flag is also set, clear all abstract embeddings first
    if (reset) {
      await db.execute(
        sql`UPDATE memories SET abstract_embedding = NULL WHERE user_id = ${userId}`
      );
      console.log(`[backfill-abstract] Reset all abstract embeddings for user ${userId}`);
    }

    const batchSize = limit > 1 ? limit : 1;
    const missing = await db
      .select({ id: memories.id, content: memories.content })
      .from(memories)
      .where(
        sql`${memories.userId} = ${userId} AND ${memories.abstractEmbedding} IS NULL AND ${memories.embedding} IS NOT NULL`
      )
      .limit(batchSize);

    let processed = 0;
    let failed = 0;
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
            return { success: true as const };
          } catch (err) {
            return {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.success) {
          processed++;
        } else {
          failed++;
          if (!firstError) {
            if (result.status === "fulfilled") {
              firstError = result.value.success
                ? "Unknown error"
                : result.value.error ?? "Unknown error";
            } else {
              firstError = String(result.reason);
            }
          }
        }
      }
    }

    const remaining = await db.execute(
      sql`SELECT COUNT(*) as count FROM memories WHERE user_id = ${userId} AND abstract_embedding IS NULL AND embedding IS NOT NULL`
    );
    const remainingCount = parseCount(
      (remaining.rows[0] as { count?: unknown } | undefined)?.count,
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

  // Legacy clean mode: delete existing memories only, then reset sync state.
  if (clean) {
    const deleted = await db
      .delete(memories)
      .where(eq(memories.userId, userId))
      .returning({ id: memories.id });
    console.log(
      `[memory-backfill] Cleaned ${deleted.length} existing memories for user ${userId}`
    );
  }

  // If clean or reset, clear sync state to force reprocessing of all files.
  if (clean || reset) {
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
