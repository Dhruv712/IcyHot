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
  groups,
  contactGroups,
} from "@/db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { retrieveMemories } from "./memory/retrieve";

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
    contactGroupMemberships,
  ] = await Promise.all([
    // Today's calendar events with matched contacts
    getTodayCalendarEvents(userId, today),
    // Recent insights (last 60 days, top by relevance)
    getRecentInsights(userId, 60),
    // Recent interactions (last 30 days)
    getRecentInteractions(userId, 30),
    // Active open loops (not resolved, not snoozed past today)
    getActiveOpenLoops(userId, today),
    // All contacts with importance + notes + bio
    db.select({
      id: contacts.id,
      name: contacts.name,
      importance: contacts.importance,
      relationshipType: contacts.relationshipType,
      notes: contacts.notes,
      bio: contacts.bio,
    }).from(contacts).where(eq(contacts.userId, userId)),
    // Contact group memberships
    db.select({
      contactId: contactGroups.contactId,
      groupName: groups.name,
    }).from(contactGroups)
      .innerJoin(groups, eq(groups.id, contactGroups.groupId))
      .innerJoin(contacts, eq(contacts.id, contactGroups.contactId))
      .where(eq(contacts.userId, userId)),
  ]);

  // Build group lookup map
  const groupsByContact = new Map<string, string[]>();
  for (const m of contactGroupMemberships) {
    const existing = groupsByContact.get(m.contactId) || [];
    existing.push(m.groupName);
    groupsByContact.set(m.contactId, existing);
  }

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
  if (todayEvents.length === 0 && patternAlerts.length === 0 && temperatureAlerts.length === 0 && activeLoops.length === 0) {
    const briefing: DailyBriefingContent = {
      todayContext: [],
      patternAlerts,
      relationshipArc: null,
      temperatureAlerts,
      summary: "No meetings today and no one's going cold. You're in good shape.",
    };
    await saveBriefing(userId, today, briefing);
    return briefing;
  }

  // ── Retrieve memories for context enrichment ──────────────────────
  // For each unique contact in meetings + cooling alerts, retrieve relevant memories
  const contactIdsForMemory = new Set<string>();
  for (const e of todayEvents) contactIdsForMemory.add(e.contactId);
  for (const t of temperatureAlerts) contactIdsForMemory.add(t.contactId);

  const memoryByContact = new Map<string, { memories: string[]; implications: string[] }>();

  try {
    const memoryPromises = Array.from(contactIdsForMemory).map(async (contactId) => {
      const contact = allContacts.find((c) => c.id === contactId);
      if (!contact) return;
      const result = await retrieveMemories(userId, contact.name, {
        maxMemories: 5,
        maxHops: 1,
        contactFilter: contactId,
        skipHebbian: true, // Don't inflate activation from briefing generation
      });
      memoryByContact.set(contactId, {
        memories: result.memories.map((m) => m.content),
        implications: result.implications.map((im) => im.content),
      });
    });
    await Promise.all(memoryPromises);
  } catch (error) {
    console.error("[briefing] Memory retrieval failed (non-blocking):", error);
    // Continue without memories — they're supplemental
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

        const contact = allContacts.find((c) => c.id === e.contactId);
        const contactGroupNames = groupsByContact.get(e.contactId) || [];

        // Sentiment trend analysis
        const sentimentCounts = { great: 0, good: 0, neutral: 0, awkward: 0 };
        for (const i of allContactInteractions) {
          if (i.sentiment && i.sentiment in sentimentCounts) {
            sentimentCounts[i.sentiment as keyof typeof sentimentCounts]++;
          }
        }
        const totalSentiments = Object.values(sentimentCounts).reduce((a, b) => a + b, 0);
        let sentimentTrend = "";
        if (totalSentiments >= 2) {
          const positiveRatio = (sentimentCounts.great + sentimentCounts.good) / totalSentiments;
          const negativeRatio = sentimentCounts.awkward / totalSentiments;
          if (positiveRatio >= 0.6) sentimentTrend = "mostly positive";
          else if (negativeRatio >= 0.4) sentimentTrend = "often awkward";
          else sentimentTrend = "mixed";
        }

        contextParts.push(`- ${e.contactName} at ${e.eventTime}: "${e.eventSummary}"`);
        if (contact) {
          contextParts.push(`  Relationship: ${contact.relationshipType}, importance: ${contact.importance}/10`);
          if (contact.bio) {
            contextParts.push(`  Bio: ${contact.bio.slice(0, 300)}`);
          }
        }
        contextParts.push(`  Total interactions on record: ${totalInteractions}${firstInteraction ? ` (first: ${firstInteraction})` : " (NO prior interactions — this may be a first meeting)"}`);
        if (contact?.notes) {
          contextParts.push(`  Notes: ${contact.notes.slice(0, 200)}`);
        }
        if (contactGroupNames.length > 0) {
          contextParts.push(`  Groups: ${contactGroupNames.join(", ")}`);
        }
        if (sentimentTrend) {
          contextParts.push(`  Sentiment trend: ${sentimentTrend} (across ${totalSentiments} interactions)`);
        }
        if (contactInteractions.length > 0) {
          contextParts.push(`  Recent interactions: ${contactInteractions.map((i) => `[${i.sentiment || "neutral"}] ${i.note?.slice(0, 100) || "no notes"}`).join("; ")}`);
        }
        if (contactLoops.length > 0) {
          contextParts.push(`  Open loops: ${contactLoops.map((l) => l.content).join("; ")}`);
        }
        if (contactInsights.length > 0) {
          contextParts.push(`  Dynamics: ${contactInsights.map((i) => i.content.slice(0, 100)).join("; ")}`);
        }
        // Memory graph context
        const contactMemory = memoryByContact.get(e.contactId);
        if (contactMemory) {
          if (contactMemory.memories.length > 0) {
            contextParts.push(`  From your memory graph: ${contactMemory.memories.slice(0, 3).map((m) => m.slice(0, 150)).join("; ")}`);
          }
          if (contactMemory.implications.length > 0) {
            contextParts.push(`  Memory insights: ${contactMemory.implications.slice(0, 2).map((im) => im.slice(0, 150)).join("; ")}`);
          }
        }
      }
    }

    // Personal reflections (general self-awareness, not contact-specific)
    const personalReflections = recentInsights
      .filter((i) => i.category === "personal_reflection")
      .slice(0, 3);
    if (personalReflections.length > 0) {
      contextParts.push("\nRECENT PERSONAL REFLECTIONS:");
      for (const r of personalReflections) {
        contextParts.push(`  [${r.entryDate}] ${r.content.slice(0, 150)}`);
      }
    }

    // Recurring themes from journal (patterns observed multiple times)
    const recurringThemes = recentInsights
      .filter((i) => i.category === "recurring_theme" && i.reinforcementCount >= 1)
      .slice(0, 4);
    if (recurringThemes.length > 0) {
      contextParts.push("\nRECURRING THEMES FROM JOURNAL:");
      for (const t of recurringThemes) {
        const contactName = t.contactId
          ? allContacts.find((c) => c.id === t.contactId)?.name
          : null;
        contextParts.push(`  [observed ${t.reinforcementCount}×${contactName ? `, about ${contactName}` : ""}] ${t.content.slice(0, 150)}`);
      }
    }

    // General open loops (not tied to a specific contact)
    const generalLoops = activeLoops.filter((l) => !l.contactId);
    if (generalLoops.length > 0) {
      contextParts.push("\nGENERAL OPEN LOOPS (not tied to a specific person):");
      for (const l of generalLoops.slice(0, 5)) {
        contextParts.push(`  [${l.entryDate}] ${l.content}`);
      }
    }

    if (temperatureAlerts.length > 0) {
      contextParts.push("\nCOOLING CONTACTS (these people need outreach):");
      for (const t of temperatureAlerts) {
        const contact = allContacts.find((c) => c.id === t.contactId);
        const contactGroupNames = groupsByContact.get(t.contactId) || [];
        const lastInteractions = recentInteractions
          .filter((i) => i.contactId === t.contactId)
          .slice(0, 2);
        const contactLoops = activeLoops.filter((l) => l.contactId === t.contactId);

        contextParts.push(`- ${t.contactName} (importance: ${t.importance}/10): ${t.daysSinceLastInteraction} days since last interaction`);
        if (contact) {
          contextParts.push(`  Relationship: ${contact.relationshipType}`);
          if (contact.bio) {
            contextParts.push(`  Bio: ${contact.bio.slice(0, 300)}`);
          }
        }
        if (contact?.notes) {
          contextParts.push(`  Notes: ${contact.notes.slice(0, 200)}`);
        }
        if (contactGroupNames.length > 0) {
          contextParts.push(`  Groups: ${contactGroupNames.join(", ")}`);
        }
        if (lastInteractions.length > 0) {
          contextParts.push(`  Last interactions: ${lastInteractions.map((i) => `[${i.sentiment || "neutral"}] ${i.note?.slice(0, 100) || "no notes"}`).join("; ")}`);
        }
        if (contactLoops.length > 0) {
          contextParts.push(`  Open loops: ${contactLoops.map((l) => l.content).join("; ")}`);
        }
        // Memory graph context for cooling contacts
        const contactMemory = memoryByContact.get(t.contactId);
        if (contactMemory) {
          if (contactMemory.memories.length > 0) {
            contextParts.push(`  From your memory graph: ${contactMemory.memories.slice(0, 3).map((m) => m.slice(0, 150)).join("; ")}`);
          }
          if (contactMemory.implications.length > 0) {
            contextParts.push(`  Memory insights: ${contactMemory.implications.slice(0, 2).map((im) => im.slice(0, 150)).join("; ")}`);
          }
        }
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
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are Dhruv's personal relationship manager and life coach. Generate a daily briefing for ${today}. Write in second person ("you").

TONE RULES — follow these strictly:
- Be direct and specific. Never hedge with "perhaps", "consider", "might be an opportunity", "could be a good time to".
- Every suggestion must be a concrete action: "Text Sarah about X", "Ask John how Y went", "Send Amy the link to Z".
– Reflections are allowed, even if they don't lead to concrete actions, but only if they're extremely insightful and expose Dhruv to realizations he wouldn't have otherwise had.
- Reference specific details from the context (last interaction topics, open loops, notes). Don't be generic. However, don't force it – for example, if Dhruv got a haircut with someone once, don't latch onto that and suggest getting haircuts again... that's not something people do.
- If you don't have enough context to say something specific, say less rather than filling space with platitudes.
- Never use therapy-speak or horoscope language. No "threads in your life's tapestry" or "invites reflection."

FAMILIARITY RULES:
- Pay close attention to "Total interactions on record." If a contact has 0-1 interactions, this is a new connection — don't assume shared history.
- Only reference specific past events if they appear in the context data.

${todayEvents.length === 0 ? `NO-MEETING DAY RULES:
- This is an open day. The reflections on recent life context and the cooling contacts ARE the main events — treat each cooling contact with the same depth as a meeting prep.
- For each cooling contact, give a specific outreach suggestion: what to say, how to reach out (text, call, grab coffee), and what NOT to bring up if relevant.
- The summary should read like a short to-do list: who to reach out to, in priority order, with one reason why for each.
` : ""}
${contextStr}

Return ONLY valid JSON:
{
  "todayContext": [
    { "contactId": "...", "contactName": "...", "eventSummary": "...", "eventTime": "...", "briefing": "2-3 sentence prep note. Be specific: what to bring up, what to remember from last time, any open loops to close. For new contacts, focus on what you know and what to ask about." }
  ],
  "relationshipArc": ${arcCandidate ? `{ "contactId": "${arcCandidate.contactId}", "contactName": "${arcCandidate.contactName}", "arc": "2-3 sentence narrative of how this relationship has evolved based on the dynamics data" }` : "null"},
  "temperatureAlerts": [
    { "contactId": "...", "contactName": "...", "importance": N, "daysSinceLastInteraction": N, "suggestion": "A specific action: 'Text her about X' or 'Send him that article about Y' — not 'consider reaching out'" }
  ],
  "summary": "3-4 sentences. ${todayEvents.length === 0 ? "Lead with who to reach out to today, in priority order, with a specific reason for each. End with any open loops that need attention." : "Lead with what matters most today — the key meeting or interaction. Then priorities for the rest of the day. End with any open loops to close."}"
}

Only include contacts that appear in the context above.`,
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
  allContacts: { id: string; name: string; importance: number; relationshipType: string; notes: string | null; bio: string | null }[],
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
