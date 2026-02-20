import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { contactIds } = body as { contactIds: string[] | null };

  // Verify the memory belongs to this user
  const [existing] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(eq(memories.id, id), eq(memories.userId, session.user.id))
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const newContactIds =
    contactIds && contactIds.length > 0
      ? JSON.stringify(contactIds)
      : null;

  await db
    .update(memories)
    .set({ contactIds: newContactIds })
    .where(eq(memories.id, id));

  return NextResponse.json({ success: true });
}
