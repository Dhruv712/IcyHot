import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalSyncState } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const filename = body.filename as string;

  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  const [syncState] = await db
    .select()
    .from(journalSyncState)
    .where(eq(journalSyncState.userId, session.user.id));

  if (!syncState?.processedFiles) {
    return NextResponse.json({ message: "No processed files found" });
  }

  const processedFiles: string[] = JSON.parse(syncState.processedFiles);
  const before = processedFiles.length;
  const filtered = processedFiles.filter((f) => f !== filename);
  const after = filtered.length;

  if (before === after) {
    return NextResponse.json({
      message: `"${filename}" not found in processed files`,
      processedFiles: filtered,
    });
  }

  await db
    .update(journalSyncState)
    .set({ processedFiles: JSON.stringify(filtered) })
    .where(eq(journalSyncState.id, syncState.id));

  return NextResponse.json({
    message: `Removed "${filename}" from processed files`,
    removed: true,
    remainingCount: after,
  });
}
