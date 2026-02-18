import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { contacts, interactions, journalInsights } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, desc } from "drizzle-orm";

export const maxDuration = 30;

// POST /api/contacts/[id]/bio — Generate a bio from journal context + interactions
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id!;

  // Fetch the contact
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));

  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch recent interactions with notes
  const recentInteractions = await db
    .select({
      note: interactions.note,
      sentiment: interactions.sentiment,
      occurredAt: interactions.occurredAt,
    })
    .from(interactions)
    .where(eq(interactions.contactId, id))
    .orderBy(desc(interactions.occurredAt))
    .limit(15);

  // Fetch journal insights about this contact
  const insights = await db
    .select({
      category: journalInsights.category,
      content: journalInsights.content,
      entryDate: journalInsights.entryDate,
    })
    .from(journalInsights)
    .where(
      and(
        eq(journalInsights.userId, userId),
        eq(journalInsights.contactId, id)
      )
    )
    .orderBy(desc(journalInsights.lastReinforcedAt))
    .limit(10);

  // Build context for LLM
  const contextParts: string[] = [];
  contextParts.push(`Contact: ${contact.name}`);
  contextParts.push(`Relationship type: ${contact.relationshipType}`);
  contextParts.push(`Importance: ${contact.importance}/10`);
  if (contact.notes) {
    contextParts.push(`Notes: ${contact.notes}`);
  }

  if (insights.length > 0) {
    contextParts.push("\nJournal insights:");
    for (const i of insights) {
      contextParts.push(`  [${i.category}, ${i.entryDate}] ${i.content}`);
    }
  }

  if (recentInteractions.length > 0) {
    contextParts.push("\nRecent interactions:");
    for (const i of recentInteractions) {
      const date = i.occurredAt.toISOString().slice(0, 10);
      contextParts.push(`  [${date}, ${i.sentiment || "neutral"}] ${i.note || "no notes"}`);
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No API key configured" }, { status: 500 });
  }

  // If we have nothing to work with, return a helpful message
  if (insights.length === 0 && recentInteractions.filter((i) => i.note).length === 0) {
    return NextResponse.json({
      bio: null,
      message: "Not enough context to generate a bio. Add some interactions or journal entries first.",
    });
  }

  try {
    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `Based on the following context about a person in someone's life, write a concise 1-2 sentence bio that captures who this person is to them. Focus on: how they know each other, what they do, shared context (groups, projects, etc.), and the nature of the relationship.

Write in third person (e.g. "College roommate from Stanford, now a PM at Stripe. Met through the CS department."). Be factual and specific — only include things supported by the data. Don't speculate or add filler.

${contextParts.join("\n")}

Bio:`,
        },
      ],
    });

    const bio =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : null;

    if (bio) {
      // Save the generated bio
      await db
        .update(contacts)
        .set({ bio, updatedAt: new Date() })
        .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
    }

    return NextResponse.json({ bio });
  } catch (error) {
    console.error("[bio-generate] Error:", error);
    return NextResponse.json({ error: "Failed to generate bio" }, { status: 500 });
  }
}
