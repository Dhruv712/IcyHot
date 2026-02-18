import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts, interactions, journalInsights } from "@/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { computeStreaks } from "@/lib/streaks";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();

  // 8 weeks back for streak detection
  const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 24 * 60 * 60 * 1000);

  const [allContacts, recentInteractions, behavioralInsights] = await Promise.all([
    // All contacts (for streak computation)
    db
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.userId, userId)),

    // Last 8 weeks of interactions
    db
      .select({
        contactId: interactions.contactId,
        occurredAt: interactions.occurredAt,
      })
      .from(interactions)
      .where(
        and(
          eq(interactions.userId, userId),
          gte(interactions.occurredAt, eightWeeksAgo)
        )
      ),

    // Behavioral habits from journal (recurring themes, not contact-specific, reinforced 2+)
    db
      .select({
        id: journalInsights.id,
        content: journalInsights.content,
        reinforcementCount: journalInsights.reinforcementCount,
        lastReinforcedAt: journalInsights.lastReinforcedAt,
      })
      .from(journalInsights)
      .where(
        and(
          eq(journalInsights.userId, userId),
          eq(journalInsights.category, "recurring_theme"),
          isNull(journalInsights.contactId),
          gte(journalInsights.reinforcementCount, 2)
        )
      )
      .orderBy(desc(journalInsights.reinforcementCount))
      .limit(5),
  ]);

  // ── Contact streaks ──────────────────────────────────────────────────
  const contactStreaks = computeStreaks(allContacts, recentInteractions, now, {
    minWeeks: 3,
    maxResults: 5,
  });

  // Determine current week boundaries (Monday–now) for thisWeekDone
  const dow = now.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset)
  );

  const streaksWithStatus = contactStreaks.map((s) => ({
    ...s,
    thisWeekDone: recentInteractions.some(
      (i) => i.contactId === s.contactId && i.occurredAt >= thisMonday
    ),
  }));

  // ── Behavioral habits ────────────────────────────────────────────────
  const behavioralHabits = behavioralInsights.map((insight) => {
    const daysSinceReinforced = Math.floor(
      (now.getTime() - insight.lastReinforcedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return {
      id: insight.id,
      content: insight.content,
      reinforcementCount: insight.reinforcementCount,
      lastReinforcedAt: insight.lastReinforcedAt.toISOString(),
      daysSinceReinforced,
      active: daysSinceReinforced <= 14,
    };
  });

  return NextResponse.json({
    contactStreaks: streaksWithStatus,
    behavioralHabits,
  });
}
