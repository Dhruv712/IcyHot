import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalReminders } from "@/db/schema";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const now = new Date();

  const [updated] = await db
    .update(journalReminders)
    .set({
      status: "dismissed",
      dismissedAt: now,
      updatedAt: now,
    })
    .where(and(eq(journalReminders.id, id), eq(journalReminders.userId, session.user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  return NextResponse.json({ reminder: updated });
}
