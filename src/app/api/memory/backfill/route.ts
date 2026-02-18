import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memories, memorySyncState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processMemories } from "@/lib/memory/pipeline";

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
  try {
    const body = await request.json();
    if (body.limit && typeof body.limit === "number") limit = body.limit;
    if (body.reset) reset = true;
    if (body.clean) clean = true;
  } catch {
    // No body or invalid JSON — use defaults
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
