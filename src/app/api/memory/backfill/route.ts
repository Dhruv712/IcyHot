import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memorySyncState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processMemories } from "@/lib/memory/pipeline";

export const maxDuration = 300; // 5 minutes — backfill can be slow

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Clear sync state to force reprocessing of ALL files
  await db
    .delete(memorySyncState)
    .where(eq(memorySyncState.userId, userId));

  console.log(`[memory-backfill] Starting backfill for user ${userId}`);

  const result = await processMemories(userId);

  return NextResponse.json({
    success: true,
    ...result,
  });
}
