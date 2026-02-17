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

  const { id: eventId } = await params;
  const body = await req.json();
  const { contactId } = body;

  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  const db = getDb();

  // Verify the event belongs to this user
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

  // Check for existing match (dedup)
  const [existing] = await db
    .select()
    .from(calendarEventContacts)
    .where(
      and(
        eq(calendarEventContacts.calendarEventId, eventId),
        eq(calendarEventContacts.contactId, contactId)
      )
    );

  if (existing) {
    return NextResponse.json({ success: true, action: "already_matched" });
  }

  // Create the manual match
  await db.insert(calendarEventContacts).values({
    calendarEventId: eventId,
    contactId,
    matchMethod: "manual",
    matchConfidence: 1.0,
    confirmed: true,
    interactionCreated: false,
  });

  // Auto-create interaction for past events
  const now = new Date();
  if (event.endTime < now) {
    await db.insert(interactions).values({
      contactId,
      userId: session.user.id,
      note: event.summary
        ? `${event.summary} (from Google Calendar)`
        : "Calendar event (manually matched)",
      calendarEventId: event.googleEventId,
      source: "calendar_confirmed",
      occurredAt: event.startTime,
    });

    await db
      .update(calendarEventContacts)
      .set({ interactionCreated: true })
      .where(
        and(
          eq(calendarEventContacts.calendarEventId, eventId),
          eq(calendarEventContacts.contactId, contactId)
        )
      );
  }

  return NextResponse.json({ success: true, action: "matched" });
}
