import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { provocations } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify the provocation belongs to this user
  const [existing] = await db
    .select({ id: provocations.id })
    .from(provocations)
    .where(
      and(eq(provocations.id, id), eq(provocations.userId, session.user.id))
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(provocations)
    .set({ dismissed: true })
    .where(eq(provocations.id, id));

  return NextResponse.json({ success: true });
}
