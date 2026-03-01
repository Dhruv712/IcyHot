import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalReminders } from "@/db/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dueAt } = (await request.json()) as { dueAt?: string };
  const nextDueAt = dueAt ? new Date(dueAt) : null;
  if (!nextDueAt || Number.isNaN(nextDueAt.getTime())) {
    return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  }

  const { id } = await params;
  const [updated] = await db
    .update(journalReminders)
    .set({
      dueAt: nextDueAt,
      updatedAt: new Date(),
    })
    .where(and(eq(journalReminders.id, id), eq(journalReminders.userId, session.user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  return NextResponse.json({ reminder: updated });
}
