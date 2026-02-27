import { db } from "@/db";
import { contacts, interactions, healthScoreSnapshots } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { computeTemperature } from "./temperature";
import { getDateStringInTimeZone, normalizeTimeZone } from "./timezone";

/**
 * Compute network health score from a list of nodes with temperature and importance.
 * Importance-weighted average temperature × 100, minus 5 per neglected important contact.
 */
export function computeHealthScore(
  nodes: { temperature: number; importance: number }[]
): number {
  if (nodes.length === 0) return 0;
  const totalImportance = nodes.reduce((sum, n) => sum + n.importance, 0);
  const weightedTemp = nodes.reduce(
    (sum, n) => sum + n.importance * n.temperature,
    0
  );
  const score = totalImportance > 0
    ? Math.round((weightedTemp / totalImportance) * 100)
    : 0;
  // Penalize for neglected important contacts
  const neglected = nodes.filter(
    (n) => n.temperature < 0.1 && n.importance >= 7
  ).length;
  return Math.max(0, score - neglected * 5);
}

/**
 * Take a daily snapshot of a user's health score and store it.
 */
export async function snapshotHealthScore(userId: string): Promise<void> {
  await snapshotHealthScoreForDate(userId, { timeZone: "UTC" });
}

export async function snapshotHealthScoreForDate(
  userId: string,
  options?: { timeZone?: string; date?: string }
): Promise<void> {
  const now = new Date();
  const timeZone = normalizeTimeZone(options?.timeZone);
  const today = options?.date ?? getDateStringInTimeZone(now, timeZone);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // Fetch contacts and interactions
  const allContacts = await db
    .select({
      id: contacts.id,
      importance: contacts.importance,
      relationshipType: contacts.relationshipType,
      decayRateOverride: contacts.decayRateOverride,
    })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  const allInteractions = await db
    .select({ contactId: interactions.contactId, occurredAt: interactions.occurredAt })
    .from(interactions)
    .where(
      and(
        eq(interactions.userId, userId),
        gte(interactions.occurredAt, sixMonthsAgo)
      )
    );

  // Group interactions by contact
  const interactionsByContact = new Map<string, { occurredAt: Date }[]>();
  for (const i of allInteractions) {
    const existing = interactionsByContact.get(i.contactId) || [];
    existing.push({ occurredAt: i.occurredAt });
    interactionsByContact.set(i.contactId, existing);
  }

  // Compute temperature for each contact
  const nodes = allContacts.map((c) => ({
    temperature: computeTemperature(
      interactionsByContact.get(c.id) || [],
      c.relationshipType,
      c.decayRateOverride,
      now
    ),
    importance: c.importance,
  }));

  const score = computeHealthScore(nodes);

  // Upsert snapshot
  await db
    .insert(healthScoreSnapshots)
    .values({ userId, snapshotDate: today, score })
    .onConflictDoUpdate({
      target: [healthScoreSnapshots.userId, healthScoreSnapshots.snapshotDate],
      set: { score, createdAt: new Date() },
    });
}
