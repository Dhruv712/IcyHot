import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalInsights, contacts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = req.nextUrl.searchParams.get("category");
  const contactId = req.nextUrl.searchParams.get("contactId");

  const conditions = [eq(journalInsights.userId, session.user.id)];

  if (category) {
    conditions.push(eq(journalInsights.category, category));
  }

  if (contactId) {
    conditions.push(eq(journalInsights.contactId, contactId));
  }

  const results = await db
    .select({
      id: journalInsights.id,
      entryDate: journalInsights.entryDate,
      category: journalInsights.category,
      contactId: journalInsights.contactId,
      contactName: contacts.name,
      content: journalInsights.content,
      reinforcementCount: journalInsights.reinforcementCount,
      relevanceScore: journalInsights.relevanceScore,
      createdAt: journalInsights.createdAt,
    })
    .from(journalInsights)
    .leftJoin(contacts, eq(journalInsights.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(journalInsights.relevanceScore))
    .limit(100);

  return NextResponse.json(results);
}
