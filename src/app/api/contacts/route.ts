import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, contactGroups } from "@/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, session.user.id!));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, relationshipType, importance, notes, groupIds, email } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [contact] = await db
    .insert(contacts)
    .values({
      userId: session.user.id!,
      name,
      relationshipType: relationshipType || "friend",
      importance: importance ?? 5,
      notes: notes || null,
      email: email || null,
    })
    .returning();

  // Insert group memberships
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    await db.insert(contactGroups).values(
      groupIds.map((gId: string) => ({ contactId: contact.id, groupId: gId }))
    );
  }

  return NextResponse.json(contact, { status: 201 });
}
