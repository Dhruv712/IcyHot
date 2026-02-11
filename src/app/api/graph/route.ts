import { NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, interactions, groups } from "@/db/schema";
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
      groupId: contact.groupId,
      groupAngle: contact.groupId
        ? groupAngles.get(contact.groupId) ?? null
        : null,
      lastInteraction: lastInteraction?.toISOString() ?? null,
      nudgeScore: nudgeScore(temperature, contact.importance),
      interactionCount: contactInteractions.length,
    };
  });

  return NextResponse.json({
    nodes,
    groups: allGroups,
  });
}
