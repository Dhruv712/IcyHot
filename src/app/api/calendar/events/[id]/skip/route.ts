import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { calendarEvents, dismissedEventTitles } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: eventId } = await params;
  const db = getDb();

  // Get the event and verify ownership
  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.userId, session.user.id)
      )
    );

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Mark this event as dismissed
  await db
    .update(calendarEvents)
    .set({ dismissed: true })
    .where(eq(calendarEvents.id, eventId));

  // Also add the title to dismissed titles (so future events with same title are auto-dismissed)
  if (event.summary?.trim()) {
    const normalizedTitle = event.summary.trim().toLowerCase();

    // Dedup: check if this title is already dismissed for this user
    const [existing] = await db
      .select()
      .from(dismissedEventTitles)
      .where(
        and(
          eq(dismissedEventTitles.userId, session.user.id),
          eq(dismissedEventTitles.title, normalizedTitle)
        )
      );

    if (!existing) {
      await db.insert(dismissedEventTitles).values({
        userId: session.user.id,
        title: normalizedTitle,
      });
    }
  }

  return NextResponse.json({ success: true });
}
