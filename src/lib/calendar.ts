import { getDb } from "@/db";
import {
  calendarSyncState,
  calendarEvents,
  calendarEventContacts,
  contacts,
  interactions,
  dismissedEventTitles,
} from "@/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { getGoogleAccessToken } from "./google";
import { matchEventAttendees, matchEventTitle } from "./matching";

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; self?: boolean }[];
  status?: string;
}

interface GoogleEventsResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface SyncResult {
  fetched: number;
  matched: number;
  created: number;
  unmatched: number;
}

/**
 * Fetch calendar events from Google and process attendee matches.
 */
export async function syncCalendarEvents(
  userId: string
): Promise<SyncResult> {
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) throw new Error("No Google access token available");

  const db = getDb();

  // Check for existing sync state
  const [syncState] = await db
    .select()
    .from(calendarSyncState)
    .where(eq(calendarSyncState.userId, userId));

  let allEvents: GoogleCalendarEvent[] = [];
  let nextSyncToken: string | undefined;

  if (syncState?.syncToken) {
    // Incremental sync
    try {
      const result = await fetchEventsFromGoogle(
        accessToken,
        { syncToken: syncState.syncToken }
      );
      allEvents = result.events;
      nextSyncToken = result.nextSyncToken;
    } catch (error) {
      // syncToken expired or invalid — do a full sync
      console.warn("Sync token invalid, doing full sync:", error);
      const result = await fetchEventsFromGoogle(accessToken, {
        timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      });
      allEvents = result.events;
      nextSyncToken = result.nextSyncToken;
    }
  } else {
    // Full initial sync: past 30 days to 14 days ahead
    const result = await fetchEventsFromGoogle(accessToken, {
      timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      timeMax: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    allEvents = result.events;
    nextSyncToken = result.nextSyncToken;
  }

  // Filter to relevant events (skip cancelled, keep events with attendees OR a title)
  const relevantEvents = allEvents.filter((e) => {
    if (e.status === "cancelled") return false;
    const nonSelfAttendees = e.attendees?.filter((a) => !a.self) || [];
    // Include events with attendees OR with a title (private events)
    return nonSelfAttendees.length > 0 || !!e.summary?.trim();
  });

  // Upsert events into our DB
  let fetched = 0;
  for (const event of relevantEvents) {
    const startTime = event.start?.dateTime ?? event.start?.date;
    const endTime = event.end?.dateTime ?? event.end?.date;
    if (!startTime || !endTime) continue;

    const nonSelfAttendees = event.attendees?.filter((a) => !a.self) || [];
    const attendeeEmails = JSON.stringify(nonSelfAttendees.map((a) => a.email));
    const attendeeNames = JSON.stringify(
      nonSelfAttendees.map((a) => a.displayName || "")
    );

    // Check if event already exists
    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.googleEventId, event.id)
        )
      );

    if (existing) {
      // Update existing event (summary, times, attendees may change)
      await db
        .update(calendarEvents)
        .set({
          summary: event.summary ?? null,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          attendeeEmails,
          attendeeNames,
          processed: false, // Re-process after update
        })
        .where(eq(calendarEvents.id, existing.id));
    } else {
      await db.insert(calendarEvents).values({
        userId,
        googleEventId: event.id,
        summary: event.summary ?? null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        attendeeEmails,
        attendeeNames,
        processed: false,
      });
    }
    fetched++;
  }

  // Update sync state
  if (syncState) {
    await db
      .update(calendarSyncState)
      .set({
        syncToken: nextSyncToken ?? syncState.syncToken,
        lastSyncedAt: new Date(),
      })
      .where(eq(calendarSyncState.id, syncState.id));
  } else {
    await db.insert(calendarSyncState).values({
      userId,
      syncToken: nextSyncToken ?? null,
      lastSyncedAt: new Date(),
      enabled: true,
    });
  }

  // Process unmatched events
  const { matched, created, unmatched } = await processUnmatchedEvents(userId);

  return { fetched, matched, created, unmatched };
}

/**
 * Fetch events from Google Calendar API with pagination.
 */
async function fetchEventsFromGoogle(
  accessToken: string,
  params: {
    syncToken?: string;
    timeMin?: string;
    timeMax?: string;
  }
): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken?: string }> {
  const allEvents: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    );

    if (params.syncToken) {
      url.searchParams.set("syncToken", params.syncToken);
    } else {
      if (params.timeMin) url.searchParams.set("timeMin", params.timeMin);
      if (params.timeMax) url.searchParams.set("timeMax", params.timeMax);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
    }
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google Calendar API error ${response.status}: ${errorText}`
      );
    }

    const data: GoogleEventsResponse = await response.json();
    if (data.items) {
      allEvents.push(...data.items);
    }
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) {
      nextSyncToken = data.nextSyncToken;
    }
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
}

/**
 * Process calendar events that haven't been matched yet.
 * Creates interactions for high-confidence past event matches.
 */
async function processUnmatchedEvents(
  userId: string
): Promise<{ matched: number; created: number; unmatched: number }> {
  const db = getDb();

  // Get unprocessed events
  const unprocessedEvents = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.processed, false)
      )
    );

  if (unprocessedEvents.length === 0) return { matched: 0, created: 0, unmatched: 0 };

  // Get user's contacts
  const userContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId));

  if (userContacts.length === 0) {
    // Mark all as processed — nothing to match against
    for (const event of unprocessedEvents) {
      await db
        .update(calendarEvents)
        .set({ processed: true })
        .where(eq(calendarEvents.id, event.id));
    }
    return { matched: 0, created: 0, unmatched: 0 };
  }

  // Load dismissed titles for this user (to auto-dismiss matching events)
  const dismissedTitleRows = await db
    .select({ title: dismissedEventTitles.title })
    .from(dismissedEventTitles)
    .where(eq(dismissedEventTitles.userId, userId));
  const dismissedTitleSet = new Set(dismissedTitleRows.map((r) => r.title));

  let totalMatched = 0;
  let totalCreated = 0;
  let totalUnmatched = 0;
  const now = new Date();

  for (const event of unprocessedEvents) {
    // Auto-dismiss events matching dismissed titles
    if (event.summary?.trim() && dismissedTitleSet.has(event.summary.trim().toLowerCase())) {
      await db
        .update(calendarEvents)
        .set({ processed: true, dismissed: true })
        .where(eq(calendarEvents.id, event.id));
      continue;
    }
    const attendeeEmails: string[] = event.attendeeEmails
      ? JSON.parse(event.attendeeEmails)
      : [];
    const attendeeNames: string[] = event.attendeeNames
      ? JSON.parse(event.attendeeNames)
      : [];

    const attendees = attendeeEmails.map((email, i) => ({
      email,
      displayName: attendeeNames[i] || null,
    }));

    // Run matching — either attendee-based or title-based for private events
    let matches: Awaited<ReturnType<typeof matchEventAttendees>>;

    if (attendees.length === 0) {
      // Private event (no attendees) — try title-based matching
      if (event.summary?.trim()) {
        matches = await matchEventTitle(
          event.summary,
          userContacts.map((c) => ({ id: c.id, name: c.name, email: c.email }))
        );
      } else {
        // No attendees and no title — nothing to match
        await db
          .update(calendarEvents)
          .set({ processed: true })
          .where(eq(calendarEvents.id, event.id));
        continue;
      }
    } else {
      matches = await matchEventAttendees(
        attendees,
        userContacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
        event.summary
      );
    }

    if (matches.length === 0 && (attendees.length > 0 || event.summary?.trim())) {
      totalUnmatched++;
    }

    for (const match of matches) {
      // Dedup: skip if this (event, contact) pair already exists
      const [existingMatch] = await db
        .select()
        .from(calendarEventContacts)
        .where(
          and(
            eq(calendarEventContacts.calendarEventId, event.id),
            eq(calendarEventContacts.contactId, match.contactId)
          )
        );
      if (existingMatch) continue;

      // Store the match in junction table
      await db.insert(calendarEventContacts).values({
        calendarEventId: event.id,
        contactId: match.contactId,
        matchMethod: match.method,
        matchConfidence: match.confidence,
        confirmed: match.confidence >= 0.9,
        interactionCreated: false,
      });
      totalMatched++;

      // Auto-create interaction for high-confidence past events
      const isPast = event.endTime < now;
      if (isPast && match.confidence >= 0.9) {
        // Dedup check: no existing interaction within ±2 hours
        const eventStart = event.startTime;
        const windowStart = new Date(eventStart.getTime() - 2 * 60 * 60 * 1000);
        const windowEnd = new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

        const existingInteractions = await db
          .select()
          .from(interactions)
          .where(
            and(
              eq(interactions.contactId, match.contactId),
              gte(interactions.occurredAt, windowStart),
              lte(interactions.occurredAt, windowEnd)
            )
          );

        if (existingInteractions.length === 0) {
          await db.insert(interactions).values({
            contactId: match.contactId,
            userId,
            note: event.summary
              ? `${event.summary} (from Google Calendar)`
              : "Calendar event (auto-detected)",
            calendarEventId: event.googleEventId,
            source: "calendar_auto",
            occurredAt: eventStart,
          });

          // Mark interaction created on junction row
          await db
            .update(calendarEventContacts)
            .set({ interactionCreated: true })
            .where(
              and(
                eq(calendarEventContacts.calendarEventId, event.id),
                eq(calendarEventContacts.contactId, match.contactId)
              )
            );
          totalCreated++;
        }
      }
    }

    // Mark event as processed
    await db
      .update(calendarEvents)
      .set({ processed: true })
      .where(eq(calendarEvents.id, event.id));
  }

  return { matched: totalMatched, created: totalCreated, unmatched: totalUnmatched };
}
