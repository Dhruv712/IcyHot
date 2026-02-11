import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq } from "drizzle-orm";

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
  const { name, color } = body;

  const [updated] = await db
    .update(groups)
    .set({
      ...(name !== undefined && { name }),
      ...(color !== undefined && { color: color || null }),
    })
    .where(and(eq(groups.id, id), eq(groups.userId, session.user.id!)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    .delete(groups)
    .where(and(eq(groups.id, id), eq(groups.userId, session.user.id!)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
