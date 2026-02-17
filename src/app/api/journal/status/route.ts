import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalSyncState } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [syncState] = await db
    .select()
    .from(journalSyncState)
    .where(eq(journalSyncState.userId, session.user.id));

  const processedFiles: string[] = syncState?.processedFiles
    ? JSON.parse(syncState.processedFiles)
    : [];

  return NextResponse.json({
    configured: !!process.env.GITHUB_PAT,
    lastSyncedAt: syncState?.lastSyncedAt?.toISOString() ?? null,
    processedCount: processedFiles.length,
  });
}
