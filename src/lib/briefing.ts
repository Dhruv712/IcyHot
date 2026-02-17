import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  contacts,
  interactions,
  journalInsights,
  journalOpenLoops,
  calendarEvents,
  calendarEventContacts,
  dailyBriefings,
} from "@/db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────

interface MeetingPrep {
  contactId: string;
  contactName: string;
  eventSummary: string;
  eventTime: string;
  briefing: string;
}

interface PatternAlert {
  pattern: string;
  occurrences: number;
  trend: "strengthening" | "stable" | "fading";
}

interface RelationshipArc {
  contactId: string;
  contactName: string;
  arc: string;
}

interface TemperatureAlert {
  contactId: string;
  contactName: string;
  importance: number;
  daysSinceLastInteraction: number;
  suggestion: string;
}

export interface DailyBriefingContent {
  todayContext: MeetingPrep[];
  patternAlerts: PatternAlert[];
  relationshipArc: RelationshipArc | null;
  temperatureAlerts: TemperatureAlert[];
  summary: string;
}

// ── Generation ─────────────────────────────────────────────────────────

export async function generateDailyBriefing(userId: string): Promise<DailyBriefingContent | null> {
  const today = new Date().toISOString().slice(0, 10);

  // Check if briefing already exists for today
  const [existing] = await db
    .select()
    .from(dailyBriefings)
    .where(
      and(
        eq(dailyBriefings.userId, userId),
        eq(dailyBriefings.briefingDate, today)
      )
    );

  if (existing) {
    return JSON.parse(existing.content) as DailyBriefingContent;
  }

  // Gather context
  const [
    todayEvents,
    recentInsights,
    recentInteractions,
    activeLoops,
    allContacts,
  ] = await Promise.all([
    // Today's calendar events with matched contacts
    getTodayCalendarEvents(userId, today),
    // Recent insights (last 60 days, top by relevance)
    getRecentInsights(userId, 60),
    // Recent interactions (last 30 days)
    getRecentInteractions(userId, 30),
    // Active open loops (not resolved, not snoozed past today)
    getActiveOpenLoops(userId, today),
    // All contacts with importance
    db.select({
      id: contacts.id,
      name: contacts.name,
      importance: contacts.importance,
      relationshipType: contacts.relationshipType,
    }).from(contacts).where(eq(contacts.userId, userId)),
  ]);

  // Compute temperature alerts (important contacts going cold)
  const temperatureAlerts = computeTemperatureAlerts(allContacts, recentInteractions);

  // Find top reinforced patterns
  const patternAlerts = recentInsights
    .filter((i) => i.category === "recurring_theme" && i.reinforcementCount >= 2)
    .slice(0, 2)
    .map((i) => ({
      pattern: i.content,
      occurrences: i.reinforcementCount,
      trend: (i.reinforcementCount >= 4 ? "strengthening" : "stable") as PatternAlert["trend"],
    }));

  // If we have no context at all, skip LLM and return a lightweight briefing
  if (todayEvents.length === 0 && patternAlerts.length === 0 && temperatureAlerts.length === 0) {
    const briefing: DailyBriefingContent = {
      todayContext: [],
      patternAlerts,
      relationshipArc: null,
      temperatureAlerts,
      summary: "A quiet day — no meetings on the calendar. A good time for reflection or reaching out to someone you've been meaning to connect with.",
    };
    await saveBriefing(userId, today, briefing);
    return briefing;
  }

  // Build LLM context for meeting prep and relationship arc
  if (!process.env.ANTHROPIC_API_KEY) {
    // Fallback: structured briefing without LLM
    const briefing: DailyBriefingContent = {
      todayContext: todayEvents.map((e) => ({
        contactId: e.contactId,
        contactName: e.contactName,
        eventSummary: e.eventSummary,
        eventTime: e.eventTime,
        briefing: `You have a meeting with ${e.contactName} today.`,
      })),
      patternAlerts,
      relationshipArc: null,
      temperatureAlerts,
      summary: todayEvents.length > 0
        ? `You have ${todayEvents.length} meeting${todayEvents.length > 1 ? "s" : ""} today.`
        : "Check your patterns and temperature alerts below.",
    };
    await saveBriefing(userId, today, briefing);
    return briefing;
  }

  try {
    const client = new Anthropic();

    // Build a compact context string for the LLM
    const contextParts: string[] = [];

    if (todayEvents.length > 0) {
      contextParts.push("TODAY'S MEETINGS:");
      for (const e of todayEvents) {
        const allContactInteractions = recentInteractions
          .filter((i) => i.contactId === e.contactId);
        const contactInteractions = allContactInteractions.slice(0, 3);
        const contactLoops = activeLoops.filter((l) => l.contactId === e.contactId);
        const contactInsights = recentInsights
          .filter((i) => i.contactId === e.contactId && i.category === "relationship_dynamic")
          .slice(0, 2);

        const totalInteractions = allContactInteractions.length;
        const firstInteraction = allContactInteractions.length > 0
          ? allContactInteractions[allContactInteractions.length - 1].occurredAt.toISOString().slice(0, 10)
          : null;

        contextParts.push(`- ${e.contactName} at ${e.eventTime}: "${e.eventSummary}"`);
        contextParts.push(`  Total interactions on record: ${totalInteractions}${firstInteraction ? ` (first: ${firstInteraction})` : " (NO prior interactions — this may be a first meeting)"}`);
        if (contactInteractions.length > 0) {
          contextParts.push(`  Recent interactions: ${contactInteractions.map((i) => `[${i.sentiment || "neutral"}] ${i.note?.slice(0, 100) || "no notes"}`).join("; ")}`);
        }
        if (contactLoops.length > 0) {
          contextParts.push(`  Open loops: ${contactLoops.map((l) => l.content).join("; ")}`);
        }
        if (contactInsights.length > 0) {
          contextParts.push(`  Dynamics: ${contactInsights.map((i) => i.content.slice(0, 100)).join("; ")}`);
        }
      }
    }

    if (temperatureAlerts.length > 0) {
      contextParts.push("\nCOOLING CONTACTS:");
      for (const t of temperatureAlerts) {
        contextParts.push(`- ${t.contactName} (importance: ${t.importance}): ${t.daysSinceLastInteraction} days since last interaction`);
      }
    }

    // Find the contact with the most relationship dynamics for an arc
    const dynamicsByContact = new Map<string, typeof recentInsights>();
    for (const insight of recentInsights) {
      if (insight.category === "relationship_dynamic" && insight.contactId) {
        const existing = dynamicsByContact.get(insight.contactId) || [];
        existing.push(insight);
        dynamicsByContact.set(insight.contactId, existing);
      }
    }
    let arcCandidate: { contactId: string; contactName: string; dynamics: string[] } | null = null;
    let maxDynamics = 1; // need at least 2 dynamics for an arc
    for (const [contactId, dynamics] of dynamicsByContact) {
      if (dynamics.length > maxDynamics) {
        maxDynamics = dynamics.length;
        const contact = allContacts.find((c) => c.id === contactId);
        if (contact) {
          arcCandidate = {
            contactId,
            contactName: contact.name,
            dynamics: dynamics.map((d) => `[${d.entryDate}] ${d.content}`),
          };
        }
      }
    }

    if (arcCandidate) {
      contextParts.push(`\nRELATIONSHIP ARC CANDIDATE - ${arcCandidate.contactName}:`);
      for (const d of arcCandidate.dynamics) {
        contextParts.push(`  ${d}`);
      }
    }

    const contextStr = contextParts.join("\n");

    const stream = client.messages.stream({
      model: "claude-opus-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are Dhruv's personal relationship intelligence system. Generate a daily briefing for ${today}. Write in second person ("you"). Be warm but concise — each piece should be 1-2 sentences max.

CRITICAL: Pay close attention to the "Total interactions on record" for each contact. If a contact has 0 or 1 total interactions, this is likely a new or very recent connection — do NOT write as if Dhruv already has an established relationship with them. Instead, frame the briefing around getting to know them, first impressions, or preparation for an initial meeting. Only reference shared history if multiple prior interactions exist.

${contextStr}

Return ONLY valid JSON:
{
  "todayContext": [
    { "contactId": "...", "contactName": "...", "eventSummary": "...", "eventTime": "...", "briefing": "1-2 sentence prep note for this meeting — what to remember, what to bring up, emotional context. For new contacts (0-1 prior interactions), focus on first impressions and getting to know them." }
  ],
  "relationshipArc": ${arcCandidate ? `{ "contactId": "${arcCandidate.contactId}", "contactName": "${arcCandidate.contactName}", "arc": "2-3 sentence narrative of how this relationship has evolved recently" }` : "null"},
  "temperatureAlerts": [
    { "contactId": "...", "contactName": "...", "importance": N, "daysSinceLastInteraction": N, "suggestion": "1 sentence natural suggestion for reconnecting" }
  ],
  "summary": "1-2 sentence overall summary of the day ahead — what matters most"
}

Only include contacts that appear in the context above. Keep it genuine and natural.`,
        },
      ],
    });

    const response = await stream.finalMessage();
    const text = response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[briefing] No JSON in LLM response");
      return null;
    }

    const llmResult = JSON.parse(jsonMatch[0]);

    const briefing: DailyBriefingContent = {
      todayContext: llmResult.todayContext || [],
      patternAlerts,
      relationshipArc: llmResult.relationshipArc || null,
      temperatureAlerts: llmResult.temperatureAlerts || temperatureAlerts,
      summary: llmResult.summary || "Here's your day at a glance.",
    };

    await saveBriefing(userId, today, briefing);
    return briefing;
  } catch (error) {
    console.error("[briefing] Generation error:", error);
    // Fallback without LLM
    const briefing: DailyBriefingContent = {
      todayContext: todayEvents.map((e) => ({
        contactId: e.contactId,
        contactName: e.contactName,
        eventSummary: e.eventSummary,
        eventTime: e.eventTime,
        briefing: `Meeting with ${e.contactName} today.`,
      })),
      patternAlerts,
      relationshipArc: null,
      temperatureAlerts,
      summary: "Your daily briefing is ready.",
    };
    await saveBriefing(userId, today, briefing);
    return briefing;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

async function getTodayCalendarEvents(userId: string, today: string) {
  const startOfDay = new Date(today + "T00:00:00");
  const endOfDay = new Date(today + "T23:59:59");

  const events = await db
    .select({
      eventId: calendarEvents.id,
      summary: calendarEvents.summary,
      startTime: calendarEvents.startTime,
      contactId: calendarEventContacts.contactId,
      contactName: contacts.name,
    })
    .from(calendarEvents)
    .innerJoin(calendarEventContacts, eq(calendarEventContacts.calendarEventId, calendarEvents.id))
    .innerJoin(contacts, eq(contacts.id, calendarEventContacts.contactId))
    .where(
      and(
        eq(calendarEvents.userId, userId),
        gte(calendarEvents.startTime, startOfDay),
        lte(calendarEvents.startTime, endOfDay),
        eq(calendarEventContacts.confirmed, true)
      )
    );

  return events.map((e) => ({
    contactId: e.contactId,
    contactName: e.contactName,
    eventSummary: e.summary || "Meeting",
    eventTime: e.startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  }));
}

async function getRecentInsights(userId: string, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return db
    .select({
      id: journalInsights.id,
      category: journalInsights.category,
      content: journalInsights.content,
      contactId: journalInsights.contactId,
      entryDate: journalInsights.entryDate,
      reinforcementCount: journalInsights.reinforcementCount,
      relevanceScore: journalInsights.relevanceScore,
    })
    .from(journalInsights)
    .where(
      and(
        eq(journalInsights.userId, userId),
        gte(journalInsights.entryDate, cutoffStr)
      )
    )
    .orderBy(desc(journalInsights.relevanceScore))
    .limit(50);
}

async function getRecentInteractions(userId: string, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return db
    .select({
      id: interactions.id,
      contactId: interactions.contactId,
      note: interactions.note,
      sentiment: interactions.sentiment,
      occurredAt: interactions.occurredAt,
    })
    .from(interactions)
    .where(
      and(
        eq(interactions.userId, userId),
        gte(interactions.occurredAt, cutoff)
      )
    )
    .orderBy(desc(interactions.occurredAt))
    .limit(100);
}

async function getActiveOpenLoops(userId: string, today: string) {
  return db
    .select({
      id: journalOpenLoops.id,
      content: journalOpenLoops.content,
      contactId: journalOpenLoops.contactId,
      entryDate: journalOpenLoops.entryDate,
    })
    .from(journalOpenLoops)
    .where(
      and(
        eq(journalOpenLoops.userId, userId),
        eq(journalOpenLoops.resolved, false),
        sql`(${journalOpenLoops.snoozedUntil} IS NULL OR ${journalOpenLoops.snoozedUntil} <= ${today})`
      )
    );
}

function computeTemperatureAlerts(
  allContacts: { id: string; name: string; importance: number; relationshipType: string }[],
  recentInteractions: { contactId: string; occurredAt: Date }[]
): TemperatureAlert[] {
  const alerts: TemperatureAlert[] = [];
  const now = Date.now();

  for (const contact of allContacts) {
    if (contact.importance < 7) continue; // Only alert for important contacts

    const lastInteraction = recentInteractions
      .filter((i) => i.contactId === contact.id)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

    const daysSince = lastInteraction
      ? Math.floor((now - lastInteraction.occurredAt.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    // Alert if no interaction in 14+ days for important contacts
    if (daysSince >= 14) {
      alerts.push({
        contactId: contact.id,
        contactName: contact.name,
        importance: contact.importance,
        daysSinceLastInteraction: daysSince,
        suggestion: `It's been ${daysSince} days since you last connected with ${contact.name}.`,
      });
    }
  }

  return alerts
    .sort((a, b) => b.daysSinceLastInteraction - a.daysSinceLastInteraction)
    .slice(0, 3);
}

async function saveBriefing(userId: string, date: string, briefing: DailyBriefingContent) {
  await db
    .insert(dailyBriefings)
    .values({
      userId,
      briefingDate: date,
      content: JSON.stringify(briefing),
    })
    .onConflictDoUpdate({
      target: [dailyBriefings.userId, dailyBriefings.briefingDate],
      set: {
        content: JSON.stringify(briefing),
        generatedAt: new Date(),
      },
    });
}
