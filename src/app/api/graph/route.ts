import { NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, interactions, groups, contactGroups } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, gte } from "drizzle-orm";
import { computeTemperature, temperatureToColor } from "@/lib/temperature";
import { computeNodeProperties, nudgeScore } from "@/lib/physics";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const now = new Date();

  // Fetch all contacts
  const allContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId));

  // Fetch all interactions from the last 6 months in one query
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

  // Fetch all groups
  const allGroups = await db
    .select()
    .from(groups)
    .where(eq(groups.userId, userId));

  // Fetch all group memberships
  const allMemberships = await db
    .select()
    .from(contactGroups);
  // Build contactId -> groupId[] map
  const groupsByContact = new Map<string, string[]>();
  for (const m of allMemberships) {
    const existing = groupsByContact.get(m.contactId) || [];
    existing.push(m.groupId);
    groupsByContact.set(m.contactId, existing);
  }

  // Group interactions by contactId
  const interactionsByContact = new Map<
    string,
    { occurredAt: Date }[]
  >();
  for (const interaction of allInteractions) {
    const existing = interactionsByContact.get(interaction.contactId) || [];
    existing.push({ occurredAt: interaction.occurredAt });
    interactionsByContact.set(interaction.contactId, existing);
  }

  // Assign group angles (evenly spaced around circle)
  const groupAngles = new Map<string, number>();
  allGroups.forEach((g, i) => {
    groupAngles.set(g.id, (i / allGroups.length) * Math.PI * 2);
  });

  // Compute graph nodes
  const nodes = allContacts.map((contact) => {
    const contactInteractions =
      interactionsByContact.get(contact.id) || [];
    const temperature = computeTemperature(
      contactInteractions,
      contact.relationshipType,
      contact.decayRateOverride,
      now
    );
    const color = temperatureToColor(temperature);
    const { mass, orbitalRadius, nodeRadius } = computeNodeProperties(
      temperature,
      contact.importance
    );
    const lastInteraction = contactInteractions.length
      ? new Date(
          Math.max(
            ...contactInteractions.map((i) => i.occurredAt.getTime())
          )
        )
      : null;

    return {
      id: contact.id,
      name: contact.name,
      relationshipType: contact.relationshipType,
      importance: contact.importance,
      temperature,
      color,
      mass,
      orbitalRadius,
      nodeRadius,
      groupIds: groupsByContact.get(contact.id) ?? [],
      groupAngle: (() => {
        const gIds = groupsByContact.get(contact.id);
        if (!gIds || gIds.length === 0) return null;
        // Average angle of all groups this contact belongs to
        const angles = gIds.map((gId) => groupAngles.get(gId)).filter((a): a is number => a !== undefined);
        if (angles.length === 0) return null;
        return angles.reduce((sum, a) => sum + a, 0) / angles.length;
      })(),
      lastInteraction: lastInteraction?.toISOString() ?? null,
      nudgeScore: nudgeScore(temperature, contact.importance),
      interactionCount: contactInteractions.length,
    };
  });

  // Compute network health score (0-100)
  let healthScore = 0;
  if (nodes.length > 0) {
    const totalImportance = nodes.reduce((sum, n) => sum + n.importance, 0);
    const weightedTemp = nodes.reduce(
      (sum, n) => sum + n.importance * n.temperature,
      0
    );
    healthScore = totalImportance > 0
      ? Math.round((weightedTemp / totalImportance) * 100)
      : 0;
    // Penalize for neglected important contacts (temp < 0.1, importance >= 7)
    const neglected = nodes.filter(
      (n) => n.temperature < 0.1 && n.importance >= 7
    ).length;
    healthScore = Math.max(0, healthScore - neglected * 5);
  }

  return NextResponse.json({
    nodes,
    groups: allGroups,
    healthScore,
  });
}
