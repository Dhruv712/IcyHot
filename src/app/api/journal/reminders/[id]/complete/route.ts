import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalReminders } from "@/db/schema";
import { advanceDueDate } from "@/lib/journalReminders";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [reminder] = await db
    .select()
    .from(journalReminders)
    .where(and(eq(journalReminders.id, id), eq(journalReminders.userId, session.user.id)))
    .limit(1);

  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  const now = new Date();
  if (reminder.repeatRule === "none") {
    const [updated] = await db
      .update(journalReminders)
      .set({
        status: "done",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(journalReminders.id, reminder.id))
      .returning();

    return NextResponse.json({ reminder: updated });
  }

  const [updated] = await db
    .update(journalReminders)
    .set({
      dueAt: advanceDueDate(reminder.dueAt, reminder.repeatRule),
      lastTriggeredAt: now,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(journalReminders.id, reminder.id))
    .returning();

  return NextResponse.json({ reminder: updated });
}
