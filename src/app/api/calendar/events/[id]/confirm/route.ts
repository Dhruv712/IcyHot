import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import {
  calendarEventContacts,
  calendarEvents,
  interactions,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { confirmed } = body;

  const db = getDb();

  // Get the match row
  const [matchRow] = await db
    .select()
    .from(calendarEventContacts)
    .where(eq(calendarEventContacts.id, id));

  if (!matchRow) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Verify the event belongs to this user
  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, matchRow.calendarEventId),
        eq(calendarEvents.userId, session.user.id)
      )
    );

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (confirmed) {
    // Create interaction
    await db.insert(interactions).values({
      contactId: matchRow.contactId,
      userId: session.user.id,
      note: event.summary
        ? `${event.summary} (from Google Calendar)`
        : "Calendar event (confirmed)",
      calendarEventId: event.googleEventId,
      source: "calendar_confirmed",
      occurredAt: event.startTime,
    });

    // Update match row
    await db
      .update(calendarEventContacts)
      .set({ confirmed: true, interactionCreated: true })
      .where(eq(calendarEventContacts.id, id));

    return NextResponse.json({ success: true, action: "confirmed" });
  } else {
    // Dismiss — delete the match row
    await db
      .delete(calendarEventContacts)
      .where(eq(calendarEventContacts.id, id));

    return NextResponse.json({ success: true, action: "dismissed" });
  }
}
