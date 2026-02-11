import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts } from "@/db/schema";
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
  const { name, relationshipType, importance, notes, groupId } = body;

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
      groupId: groupId || null,
    })
    .returning();

  return NextResponse.json(contact, { status: 201 });
}
