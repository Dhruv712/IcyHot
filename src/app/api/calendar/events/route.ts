import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import {
  calendarEventContacts,
  calendarEvents,
  contacts,
} from "@/db/schema";
import { eq, and, asc, notInArray, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const contactId = req.nextUrl.searchParams.get("contactId");
  const db = getDb();

  // Per-contact calendar timeline: all events matched to a specific contact
  if (contactId) {
    const events = await db
      .select({
        id: calendarEventContacts.id,
        eventSummary: calendarEvents.summary,
        eventStart: calendarEvents.startTime,
        eventEnd: calendarEvents.endTime,
        matchMethod: calendarEventContacts.matchMethod,
        matchConfidence: calendarEventContacts.matchConfidence,
        confirmed: calendarEventContacts.confirmed,
        interactionCreated: calendarEventContacts.interactionCreated,
      })
      .from(calendarEventContacts)
      .innerJoin(
        calendarEvents,
        eq(calendarEventContacts.calendarEventId, calendarEvents.id)
      )
      .where(
        and(
          eq(calendarEventContacts.contactId, contactId),
          eq(calendarEvents.userId, session.user.id)
        )
      )
      .orderBy(asc(calendarEvents.startTime));

    return NextResponse.json(events);
  }

  if (status === "unmatched") {
    // Get processed events that have no matches in calendarEventContacts
    const matchedEventIds = db
      .select({ id: calendarEventContacts.calendarEventId })
      .from(calendarEventContacts);

    const unmatchedEvents = await db
      .select({
        id: calendarEvents.id,
        summary: calendarEvents.summary,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
        attendeeEmails: calendarEvents.attendeeEmails,
        attendeeNames: calendarEvents.attendeeNames,
      })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, session.user.id),
          eq(calendarEvents.processed, true),
          eq(calendarEvents.dismissed, false),
          sql`${calendarEvents.id} NOT IN (${matchedEventIds})`
        )
      )
      .orderBy(asc(calendarEvents.startTime));

    return NextResponse.json(unmatchedEvents);
  }

  if (status === "pending") {
    // Get all unconfirmed, non-created matches for this user's events
    const allMatches = await db
      .select({
        id: calendarEventContacts.id,
        eventSummary: calendarEvents.summary,
        eventDate: calendarEvents.startTime,
        contactId: calendarEventContacts.contactId,
        contactName: contacts.name,
        matchMethod: calendarEventContacts.matchMethod,
        matchConfidence: calendarEventContacts.matchConfidence,
      })
      .from(calendarEventContacts)
      .innerJoin(
        calendarEvents,
        eq(calendarEventContacts.calendarEventId, calendarEvents.id)
      )
      .innerJoin(
        contacts,
        eq(calendarEventContacts.contactId, contacts.id)
      )
      .where(
        and(
          eq(calendarEvents.userId, session.user.id),
          eq(calendarEventContacts.confirmed, false),
          eq(calendarEventContacts.interactionCreated, false)
        )
      );

    return NextResponse.json(allMatches);
  }

  // Default: return all calendar events for this user
  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.userId, session.user.id));

  return NextResponse.json(events);
}
