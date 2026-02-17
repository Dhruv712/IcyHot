import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasCalendarAccess } from "@/lib/google";
import { getDb } from "@/db";
import { calendarSyncState } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await hasCalendarAccess(session.user.id);

  let lastSyncedAt: string | null = null;
  let enabled = true;

  if (connected) {
    const db = getDb();
    const [syncState] = await db
      .select()
      .from(calendarSyncState)
      .where(eq(calendarSyncState.userId, session.user.id));

    if (syncState) {
      lastSyncedAt = syncState.lastSyncedAt?.toISOString() ?? null;
      enabled = syncState.enabled;
    }
  }

  return NextResponse.json({ connected, lastSyncedAt, enabled });
}
