import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  contacts,
  interactions,
  journalInsights,
  journalOpenLoops,
  calendarEvents,
  calendarEventContacts,
  weeklyRetros,
  healthScoreSnapshots,
} from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { computeTemperature } from "./temperature";
import { computeHealthScore } from "./health";
import { computeStreaks, type ContactStreak } from "./streaks";

// ── Types ──────────────────────────────────────────────────────────────

interface RetroStats {
  uniqueContacts: number;
  totalInteractions: number;
  priorWeekUniqueContacts: number;
  priorWeekTotalInteractions: number;
}

interface HealthScoreDelta {
  current: number;
  priorWeek: number;
}

interface ContactTempDelta {
  contactId: string;
  name: string;
  tempBefore: number;
  tempAfter: number;
}

interface TopMoment {
  contactId: string;
  name: string;
  summary: string;
}

export interface WeeklyRetroContent {
  weekSummary: string;
  stats: RetroStats;
  healthScore: HealthScoreDelta;
  risingContacts: ContactTempDelta[];
  fallingContacts: ContactTempDelta[];
  topMoments: TopMoment[];
  streaks: ContactStreak[];
  patternsReinforced: string[];
  nextWeekPreview: string[];
}

// ── Generation ─────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setUTCDate(diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

export async function generateWeeklyRetro(
  userId: string
): Promise<WeeklyRetroContent | null> {
  const now = new Date();
  const weekStart = getMonday(now);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const priorWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // Cache check
  const [existing] = await db
    .select()
    .from(weeklyRetros)
    .where(
      and(
        eq(weeklyRetros.userId, userId),
        eq(weeklyRetros.weekStart, weekStartStr)
      )
    );

  if (existing) {
    return JSON.parse(existing.content) as WeeklyRetroContent;
  }

  // Parallel queries
  const [
    thisWeekInteractions,
    priorWeekInteractions,
    allContacts,
    allInteractions6m,
    thisWeekInsights,
    resolvedLoops,
    nextWeekEvents,
  ] = await Promise.all([
    // This week's interactions
    db
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
          gte(interactions.occurredAt, weekStart),
          lte(interactions.occurredAt, weekEnd)
        )
      )
      .orderBy(desc(interactions.occurredAt)),

    // Prior week's interactions
    db
      .select({
        id: interactions.id,
        contactId: interactions.contactId,
        occurredAt: interactions.occurredAt,
      })
      .from(interactions)
      .where(
        and(
          eq(interactions.userId, userId),
          gte(interactions.occurredAt, priorWeekStart),
          lte(interactions.occurredAt, weekStart)
        )
      ),

    // All contacts
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        importance: contacts.importance,
        relationshipType: contacts.relationshipType,
        decayRateOverride: contacts.decayRateOverride,
      })
      .from(contacts)
      .where(eq(contacts.userId, userId)),

    // All interactions (6 months) for temperature computation
    db
      .select({
        contactId: interactions.contactId,
        occurredAt: interactions.occurredAt,
      })
      .from(interactions)
      .where(
        and(
          eq(interactions.userId, userId),
          gte(interactions.occurredAt, sixMonthsAgo)
        )
      ),

    // This week's journal insights
    db
      .select({
        category: journalInsights.category,
        content: journalInsights.content,
        contactId: journalInsights.contactId,
        reinforcementCount: journalInsights.reinforcementCount,
      })
      .from(journalInsights)
      .where(
        and(
          eq(journalInsights.userId, userId),
          gte(journalInsights.entryDate, weekStartStr),
          lte(journalInsights.entryDate, weekEnd.toISOString().slice(0, 10))
        )
      ),

    // Resolved open loops this week
    db
      .select({
        content: journalOpenLoops.content,
        contactId: journalOpenLoops.contactId,
      })
      .from(journalOpenLoops)
      .where(
        and(
          eq(journalOpenLoops.userId, userId),
          eq(journalOpenLoops.resolved, true),
          gte(journalOpenLoops.resolvedAt, weekStart)
        )
      ),

    // Next week's calendar events
    db
      .select({
        summary: calendarEvents.summary,
        startTime: calendarEvents.startTime,
        contactId: calendarEventContacts.contactId,
        contactName: contacts.name,
      })
      .from(calendarEvents)
      .innerJoin(
        calendarEventContacts,
        eq(calendarEventContacts.calendarEventId, calendarEvents.id)
      )
      .innerJoin(contacts, eq(contacts.id, calendarEventContacts.contactId))
      .where(
        and(
          eq(calendarEvents.userId, userId),
          gte(calendarEvents.startTime, weekEnd),
          lte(
            calendarEvents.startTime,
            new Date(weekEnd.getTime() + 7 * 24 * 60 * 60 * 1000)
          ),
          eq(calendarEventContacts.confirmed, true)
        )
      )
      .orderBy(calendarEvents.startTime),
  ]);

  // Group 6m interactions by contact
  const interactionsByContact = new Map<string, { occurredAt: Date }[]>();
  for (const i of allInteractions6m) {
    const existing = interactionsByContact.get(i.contactId) || [];
    existing.push({ occurredAt: i.occurredAt });
    interactionsByContact.set(i.contactId, existing);
  }

  // ── Temperature deltas ──────────────────────────────────────────────
  const risingContacts: ContactTempDelta[] = [];
  const fallingContacts: ContactTempDelta[] = [];

  for (const c of allContacts) {
    const contactInts = interactionsByContact.get(c.id) || [];
    const tempBefore = computeTemperature(
      contactInts,
      c.relationshipType,
      c.decayRateOverride,
      weekStart
    );
    const tempAfter = computeTemperature(
      contactInts,
      c.relationshipType,
      c.decayRateOverride,
      weekEnd > now ? now : weekEnd
    );
    const delta = tempAfter - tempBefore;
    if (delta > 0.1) {
      risingContacts.push({
        contactId: c.id,
        name: c.name,
        tempBefore: Math.round(tempBefore * 100) / 100,
        tempAfter: Math.round(tempAfter * 100) / 100,
      });
    } else if (delta < -0.1) {
      fallingContacts.push({
        contactId: c.id,
        name: c.name,
        tempBefore: Math.round(tempBefore * 100) / 100,
        tempAfter: Math.round(tempAfter * 100) / 100,
      });
    }
  }

  // Sort by magnitude of change
  risingContacts.sort((a, b) => (b.tempAfter - b.tempBefore) - (a.tempAfter - a.tempBefore));
  fallingContacts.sort((a, b) => (a.tempAfter - a.tempBefore) - (b.tempAfter - b.tempBefore));

  // ── Streaks ─────────────────────────────────────────────────────────
  const streaks = computeStreaks(
    allContacts.map((c) => ({ id: c.id, name: c.name })),
    allInteractions6m,
    weekStart,
    { minWeeks: 3, maxResults: 5 }
  );

  // ── Stats ───────────────────────────────────────────────────────────
  const thisWeekContactIds = new Set(thisWeekInteractions.map((i) => i.contactId));
  const priorWeekContactIds = new Set(priorWeekInteractions.map((i) => i.contactId));
  const stats: RetroStats = {
    uniqueContacts: thisWeekContactIds.size,
    totalInteractions: thisWeekInteractions.length,
    priorWeekUniqueContacts: priorWeekContactIds.size,
    priorWeekTotalInteractions: priorWeekInteractions.length,
  };

  // ── Health score delta ──────────────────────────────────────────────
  const nodesNow = allContacts.map((c) => ({
    temperature: computeTemperature(
      interactionsByContact.get(c.id) || [],
      c.relationshipType,
      c.decayRateOverride,
      weekEnd > now ? now : weekEnd
    ),
    importance: c.importance,
  }));
  const nodesWeekAgo = allContacts.map((c) => ({
    temperature: computeTemperature(
      interactionsByContact.get(c.id) || [],
      c.relationshipType,
      c.decayRateOverride,
      weekStart
    ),
    importance: c.importance,
  }));
  const healthScore: HealthScoreDelta = {
    current: computeHealthScore(nodesNow),
    priorWeek: computeHealthScore(nodesWeekAgo),
  };

  // ── Patterns reinforced this week ───────────────────────────────────
  const patternsReinforced = thisWeekInsights
    .filter((i) => i.category === "recurring_theme" && i.reinforcementCount >= 2)
    .slice(0, 4)
    .map((i) => i.content);

  // ── Next week preview ───────────────────────────────────────────────
  const nextWeekPreview = nextWeekEvents.slice(0, 5).map((e) => {
    const day = e.startTime.toLocaleDateString("en-US", { weekday: "short" });
    return `${day}: ${e.summary || "Meeting"} with ${e.contactName}`;
  });

  // ── LLM generation for weekSummary + topMoments ─────────────────────
  let weekSummary = "";
  let topMoments: TopMoment[] = [];

  if (process.env.ANTHROPIC_API_KEY && thisWeekInteractions.length > 0) {
    try {
      const client = new Anthropic();
      const contactNameMap = new Map(allContacts.map((c) => [c.id, c.name]));

      const contextParts: string[] = [];

      contextParts.push("THIS WEEK'S INTERACTIONS:");
      for (const i of thisWeekInteractions.slice(0, 30)) {
        const name = contactNameMap.get(i.contactId) || "Unknown";
        const day = i.occurredAt.toLocaleDateString("en-US", { weekday: "short" });
        contextParts.push(
          `- ${day}: ${name} [${i.sentiment || "neutral"}] ${i.note?.slice(0, 150) || "no notes"}`
        );
      }

      if (resolvedLoops.length > 0) {
        contextParts.push("\nOPEN LOOPS RESOLVED THIS WEEK:");
        for (const l of resolvedLoops.slice(0, 5)) {
          const name = l.contactId ? contactNameMap.get(l.contactId) || "" : "";
          contextParts.push(`- ${l.content}${name ? ` (${name})` : ""}`);
        }
      }

      contextParts.push(`\nSTATS: ${stats.totalInteractions} interactions with ${stats.uniqueContacts} people (prior week: ${stats.priorWeekTotalInteractions} with ${stats.priorWeekUniqueContacts})`);
      contextParts.push(`HEALTH SCORE: ${healthScore.current} (was ${healthScore.priorWeek})`);

      if (risingContacts.length > 0) {
        contextParts.push(
          `\nRISING: ${risingContacts.slice(0, 5).map((c) => `${c.name} (${c.tempBefore}→${c.tempAfter})`).join(", ")}`
        );
      }
      if (fallingContacts.length > 0) {
        contextParts.push(
          `COOLING: ${fallingContacts.slice(0, 5).map((c) => `${c.name} (${c.tempBefore}→${c.tempAfter})`).join(", ")}`
        );
      }

      if (patternsReinforced.length > 0) {
        contextParts.push(`\nPATTERNS: ${patternsReinforced.join("; ")}`);
      }

      const contextStr = contextParts.join("\n");

      const stream = client.messages.stream({
        model: "claude-opus-4-20250514",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: `You are Dhruv's personal relationship manager. Generate a weekly retrospective for the week of ${weekStartStr}. Write in second person ("you").

TONE: Direct, specific, no hedging. Reference actual interactions and names. No therapy-speak or platitudes.

${contextStr}

Return ONLY valid JSON:
{
  "weekSummary": "3-4 sentence narrative of the week. What defined it, what shifted, what stood out. Be specific about people and interactions.",
  "topMoments": [
    { "contactId": "...", "name": "...", "summary": "One sentence about a meaningful interaction this week" }
  ]
}

Include 2-4 topMoments from the most meaningful interactions. Only include contacts that appear in the data above.`,
          },
        ],
      });

      const response = await stream.finalMessage();
      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const llmResult = JSON.parse(jsonMatch[0]);
        weekSummary = llmResult.weekSummary || "";
        topMoments = llmResult.topMoments || [];
      }
    } catch (error) {
      console.error("[retro] LLM generation error:", error);
    }
  }

  // Fallback summary if LLM failed or no interactions
  if (!weekSummary) {
    if (thisWeekInteractions.length === 0) {
      weekSummary = "A quiet week — no logged interactions. Sometimes that's fine, sometimes it's a signal.";
    } else {
      weekSummary = `You connected with ${stats.uniqueContacts} ${stats.uniqueContacts === 1 ? "person" : "people"} across ${stats.totalInteractions} interactions this week.`;
    }
  }

  const retro: WeeklyRetroContent = {
    weekSummary,
    stats,
    healthScore,
    risingContacts: risingContacts.slice(0, 5),
    fallingContacts: fallingContacts.slice(0, 5),
    topMoments,
    streaks: streaks.slice(0, 5),
    patternsReinforced,
    nextWeekPreview,
  };

  // Save
  await db
    .insert(weeklyRetros)
    .values({
      userId,
      weekStart: weekStartStr,
      content: JSON.stringify(retro),
    })
    .onConflictDoUpdate({
      target: [weeklyRetros.userId, weeklyRetros.weekStart],
      set: {
        content: JSON.stringify(retro),
        generatedAt: new Date(),
      },
    });

  return retro;
}
