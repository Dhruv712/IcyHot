import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { interactions, contacts } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contactId = req.nextUrl.searchParams.get("contactId");

  if (contactId) {
    const result = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.contactId, contactId),
          eq(interactions.userId, session.user.id!)
        )
      )
      .orderBy(desc(interactions.occurredAt));

    return NextResponse.json(result);
  }

  const result = await db
    .select()
    .from(interactions)
    .where(eq(interactions.userId, session.user.id!))
    .orderBy(desc(interactions.occurredAt))
    .limit(50);

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { contactId, note, occurredAt } = body;

  if (!contactId) {
    return NextResponse.json(
      { error: "contactId is required" },
      { status: 400 }
    );
  }

  // Verify the contact belongs to this user
  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.id, contactId), eq(contacts.userId, session.user.id!))
    );

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const [interaction] = await db
    .insert(interactions)
    .values({
      contactId,
      userId: session.user.id!,
      note: note || null,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    })
    .returning();

  return NextResponse.json(interaction, { status: 201 });
}
