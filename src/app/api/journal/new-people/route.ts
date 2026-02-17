import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalNewPeople, contacts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await db
    .select()
    .from(journalNewPeople)
    .where(
      and(
        eq(journalNewPeople.userId, session.user.id),
        eq(journalNewPeople.dismissed, false)
      )
    )
    .orderBy(desc(journalNewPeople.entryDate))
    .limit(50);

  return NextResponse.json(results);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, action } = body;

  if (!id || !action) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 });
  }

  // Verify ownership
  const [person] = await db
    .select()
    .from(journalNewPeople)
    .where(
      and(
        eq(journalNewPeople.id, id),
        eq(journalNewPeople.userId, session.user.id)
      )
    );

  if (!person) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "dismiss") {
    await db
      .update(journalNewPeople)
      .set({ dismissed: true })
      .where(eq(journalNewPeople.id, id));
    return NextResponse.json({ success: true });
  }

  if (action === "add") {
    // Create a new contact
    const [newContact] = await db
      .insert(contacts)
      .values({
        userId: session.user.id,
        name: person.name,
        notes: person.context,
      })
      .returning();

    // Link back to the journal mention
    await db
      .update(journalNewPeople)
      .set({ contactId: newContact.id, dismissed: true })
      .where(eq(journalNewPeople.id, id));

    return NextResponse.json({ success: true, contactId: newContact.id });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
