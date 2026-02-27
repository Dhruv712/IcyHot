import { NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, interactions, dailySuggestions } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, gte } from "drizzle-orm";
import { computeTemperature, temperatureToColor, temperatureLabel } from "@/lib/temperature";
import { nudgeScore } from "@/lib/physics";
import { RELATIONSHIP_LABELS } from "@/lib/constants";
import Anthropic from "@anthropic-ai/sdk";
import { addDaysToDateString, getDateStringInTimeZone, getUtcDayRangeForDateInTimeZone } from "@/lib/timezone";
import { getUserTimeZone } from "@/lib/userTimeZone";

interface Suggestion {
  id: string;
  name: string;
  temperature: number;
  color: string;
  relationshipType: string;
  lastInteraction: string | null;
  blurb: string;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const now = new Date();
  const timeZone = await getUserTimeZone(userId);
  const todayStr = getDateStringInTimeZone(now, timeZone);
  const todayStart = getUtcDayRangeForDateInTimeZone(todayStr, timeZone).start;
  const tomorrowStart = getUtcDayRangeForDateInTimeZone(
    addDaysToDateString(todayStr, 1),
    timeZone,
  ).start;

  // ── Check for cached suggestions for today ─────────────────────────
  const cached = await db
    .select({
      contactId: dailySuggestions.contactId,
      blurb: dailySuggestions.blurb,
      name: contacts.name,
      relationshipType: contacts.relationshipType,
      importance: contacts.importance,
      decayRateOverride: contacts.decayRateOverride,
    })
    .from(dailySuggestions)
    .innerJoin(contacts, eq(dailySuggestions.contactId, contacts.id))
    .where(
      and(
        eq(dailySuggestions.userId, userId),
        eq(dailySuggestions.suggestedDate, todayStr)
      )
    );

  if (cached.length > 0) {
    // Recompute temperature live (it changes throughout the day as interactions happen)
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const cachedContactIds = cached.map((c) => c.contactId);
    const cachedInteractions = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.userId, userId),
          gte(interactions.occurredAt, sixMonthsAgo)
        )
      );

    const ixByContact = new Map<string, { occurredAt: Date }[]>();
    for (const ix of cachedInteractions) {
      if (cachedContactIds.includes(ix.contactId)) {
        const arr = ixByContact.get(ix.contactId) || [];
        arr.push({ occurredAt: ix.occurredAt });
        ixByContact.set(ix.contactId, arr);
      }
    }

    const suggestions: Suggestion[] = cached.map((c) => {
      const contactIxs = ixByContact.get(c.contactId) || [];
      const temperature = computeTemperature(
        contactIxs,
        c.relationshipType,
        c.decayRateOverride,
        now
      );
      const sorted = [...contactIxs].sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
      );
      return {
        id: c.contactId,
        name: c.name,
        temperature,
        color: temperatureToColor(temperature),
        relationshipType: c.relationshipType,
        lastInteraction: sorted[0]?.occurredAt.toISOString() ?? null,
        blurb: c.blurb,
      };
    });

    return NextResponse.json({ suggestions });
  }

  // ── No cached suggestions — generate fresh ─────────────────────────

  // Fetch all contacts
  const allContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId));

  if (allContacts.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  // Fetch all interactions from last 6 months (including note + sentiment)
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const allInteractions = await db
    .select()
    .from(interactions)
    .where(
      and(
        eq(interactions.userId, userId),
        gte(interactions.occurredAt, sixMonthsAgo)
      )
    );

  // Group interactions by contactId
  const interactionsByContact = new Map<
    string,
    { occurredAt: Date; note: string | null; sentiment: string | null; source: string | null }[]
  >();
  for (const ix of allInteractions) {
    const existing = interactionsByContact.get(ix.contactId) || [];
    existing.push({
      occurredAt: ix.occurredAt,
      note: ix.note,
      sentiment: ix.sentiment,
      source: ix.source,
    });
    interactionsByContact.set(ix.contactId, existing);
  }

  // Build candidate list with temperature + nudgeScore
  const candidates = allContacts.map((contact) => {
    const contactIxs = interactionsByContact.get(contact.id) || [];
    const temperature = computeTemperature(
      contactIxs,
      contact.relationshipType,
      contact.decayRateOverride,
      now
    );

    // Sort interactions by date desc
    const sorted = [...contactIxs].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
    );

    const lastIx = sorted[0] ?? null;
    const interactedToday = lastIx
      ? lastIx.occurredAt >= todayStart && lastIx.occurredAt < tomorrowStart
      : false;

    return {
      contact,
      temperature,
      color: temperatureToColor(temperature),
      score: nudgeScore(temperature, contact.importance),
      lastInteraction: lastIx?.occurredAt ?? null,
      interactedToday,
      recentInteractions: sorted.slice(0, 3),
    };
  });

  // Filter out contacts interacted with today, sort by nudgeScore
  let pool = candidates.filter((c) => !c.interactedToday);

  // If everyone was contacted today, use all candidates
  if (pool.length < 2) {
    pool = candidates;
  }

  pool.sort((a, b) => b.score - a.score);

  // Take top 8 for LLM consideration
  const shortlist = pool.slice(0, 8);

  if (shortlist.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  // Try LLM-powered selection
  let suggestions: Suggestion[] | null = null;

  if (process.env.ANTHROPIC_API_KEY && shortlist.length >= 2) {
    suggestions = await selectWithLLM(shortlist, now);
  }

  // Fallback: template-based
  if (!suggestions) {
    suggestions = shortlist.slice(0, 2).map((c) => ({
      id: c.contact.id,
      name: c.contact.name,
      temperature: c.temperature,
      color: c.color,
      relationshipType: c.contact.relationshipType,
      lastInteraction: c.lastInteraction?.toISOString() ?? null,
      blurb: buildTemplateBlurb(c, now),
    }));
  }

  // Save today's suggestions to DB for persistence across devices/refreshes
  if (suggestions.length > 0) {
    await db.insert(dailySuggestions).values(
      suggestions.map((s) => ({
        userId,
        contactId: s.id,
        blurb: s.blurb,
        suggestedDate: todayStr,
      }))
    );
  }

  return NextResponse.json({ suggestions });
}

// ── LLM-powered selection ──────────────────────────────────────────────

interface Candidate {
  contact: typeof contacts.$inferSelect;
  temperature: number;
  color: string;
  score: number;
  lastInteraction: Date | null;
  recentInteractions: {
    occurredAt: Date;
    note: string | null;
    sentiment: string | null;
    source: string | null;
  }[];
}

async function selectWithLLM(
  shortlist: Candidate[],
  now: Date
): Promise<Suggestion[] | null> {
  try {
    const client = new Anthropic();

    const candidateDescriptions = shortlist
      .map((c, i) => {
        const daysSince = c.lastInteraction
          ? Math.floor((now.getTime() - c.lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        const tempLbl = temperatureLabel(c.temperature);
        const relLabel = RELATIONSHIP_LABELS[c.contact.relationshipType] ?? c.contact.relationshipType;

        let desc = `${i + 1}. "${c.contact.name}" (id: "${c.contact.id}")
   - Relationship: ${relLabel}, Importance: ${c.contact.importance}/10
   - Temperature: ${tempLbl} (${c.temperature.toFixed(2)})
   - Last contact: ${daysSince !== null ? `${daysSince} days ago` : "Never"}`;

        // Recent interactions
        if (c.recentInteractions.length > 0) {
          desc += `\n   - Recent interactions:`;
          for (const ix of c.recentInteractions) {
            const dAgo = Math.floor((now.getTime() - ix.occurredAt.getTime()) / (1000 * 60 * 60 * 24));
            const parts = [`${dAgo}d ago`];
            if (ix.sentiment) parts.push(`sentiment: ${ix.sentiment}`);
            if (ix.note) parts.push(`"${ix.note.slice(0, 120)}"`);
            desc += `\n     • ${parts.join(" — ")}`;
          }
        }

        // Contact notes
        if (c.contact.notes) {
          desc += `\n   - My notes about them: "${c.contact.notes.slice(0, 200)}"`;
        }

        return desc;
      })
      .join("\n\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are helping me stay connected with the people I care about. Below are contacts I haven't spoken to recently. Pick the 2 I should reach out to TODAY and write a short, natural blurb (1 sentence max) for each.

Bias toward people where:
- A follow-up would be useful (a topic was mentioned, something was promised, a life event to check in on)
- The relationship is important but cooling fast
- Last interaction sentiment was notable (great → maintain that momentum, awkward → worth reconnecting to smooth things over)
- There's something specific to talk about based on the notes

Contacts:

${candidateDescriptions}

Return ONLY a JSON array with exactly 2 elements (no markdown, no explanation):
[{"contactId": "...", "blurb": "..."}]

The blurb should sound like a friend reminding you — specific and actionable when possible. Keep it to 1 short sentence. Don't start with their name.`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      contactId: string;
      blurb: string;
    }[];

    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Map back to Suggestion objects
    const candidateMap = new Map(shortlist.map((c) => [c.contact.id, c]));
    const suggestions: Suggestion[] = [];

    for (const pick of parsed.slice(0, 2)) {
      const c = candidateMap.get(pick.contactId);
      if (!c) continue;
      suggestions.push({
        id: c.contact.id,
        name: c.contact.name,
        temperature: c.temperature,
        color: c.color,
        relationshipType: c.contact.relationshipType,
        lastInteraction: c.lastInteraction?.toISOString() ?? null,
        blurb: pick.blurb,
      });
    }

    return suggestions.length >= 1 ? suggestions : null;
  } catch (error) {
    console.error("LLM suggestion error:", error);
    return null;
  }
}

// ── Template fallback ──────────────────────────────────────────────────

function buildTemplateBlurb(c: Candidate, now: Date): string {
  const daysSince = c.lastInteraction
    ? Math.floor((now.getTime() - c.lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const timeAgo =
    daysSince === null
      ? null
      : daysSince < 7
        ? `${daysSince} days ago`
        : daysSince < 30
          ? `${Math.floor(daysSince / 7)} weeks ago`
          : `${Math.floor(daysSince / 30)} months ago`;

  const relLabel = RELATIONSHIP_LABELS[c.contact.relationshipType] ?? c.contact.relationshipType;

  // Priority 1: Last interaction has a note
  const lastNote = c.recentInteractions[0]?.note;
  if (lastNote && timeAgo) {
    const truncated = lastNote.length > 60 ? lastNote.slice(0, 57) + "..." : lastNote;
    return `You last connected ${timeAgo} — "${truncated}"`;
  }

  // Priority 2: Contact has notes
  if (c.contact.notes && timeAgo) {
    const snippet = c.contact.notes.length > 60 ? c.contact.notes.slice(0, 57) + "..." : c.contact.notes;
    return `It's been ${timeAgo} since you last talked. Maybe check in about "${snippet}"`;
  }

  // Priority 3: Has interactions but no notes
  if (timeAgo) {
    const tempLbl = temperatureLabel(c.temperature).toLowerCase();
    return `${c.contact.name} is going ${tempLbl}. Last caught up ${timeAgo}.`;
  }

  // Priority 4: Never interacted
  return `You haven't connected with ${c.contact.name} yet — they're a ${relLabel.toLowerCase()}.`;
}
