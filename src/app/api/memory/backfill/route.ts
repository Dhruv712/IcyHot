import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memorySyncState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processMemories } from "@/lib/memory/pipeline";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse options from request body
  let limit = 1;
  let reset = false;
  try {
    const body = await request.json();
    if (body.limit && typeof body.limit === "number") limit = body.limit;
    if (body.reset) reset = true;
  } catch {
    // No body or invalid JSON — use defaults
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
