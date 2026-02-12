import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, interactions, contactGroups } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, session.user.id!)));

  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contactInteractions = await db
    .select()
    .from(interactions)
    .where(eq(interactions.contactId, id))
    .orderBy(desc(interactions.occurredAt));

  return NextResponse.json({ ...contact, interactions: contactInteractions });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, relationshipType, importance, notes, groupIds, decayRateOverride } = body;

  const [updated] = await db
    .update(contacts)
    .set({
      ...(name !== undefined && { name }),
      ...(relationshipType !== undefined && { relationshipType }),
      ...(importance !== undefined && { importance }),
      ...(notes !== undefined && { notes }),
      ...(decayRateOverride !== undefined && {
        decayRateOverride: decayRateOverride || null,
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, id), eq(contacts.userId, session.user.id!)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Replace group memberships if groupIds is provided
  if (groupIds !== undefined) {
    await db.delete(contactGroups).where(eq(contactGroups.contactId, id));
    if (Array.isArray(groupIds) && groupIds.length > 0) {
      await db.insert(contactGroups).values(
        groupIds.map((gId: string) => ({ contactId: id, groupId: gId }))
      );
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [deleted] = await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, session.user.id!)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
