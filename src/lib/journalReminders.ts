import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, journalReminders } from "@/db/schema";

export type JournalReminderRepeatRule = "none" | "daily" | "weekly" | "monthly";
export type JournalReminderStatus = "active" | "done" | "dismissed";

export function advanceDueDate(current: Date, repeatRule: JournalReminderRepeatRule): Date {
  const next = new Date(current);
  if (repeatRule === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (repeatRule === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (repeatRule === "monthly") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  return next;
}

export function isValidReminderRepeatRule(value: unknown): value is JournalReminderRepeatRule {
  return value === "none" || value === "daily" || value === "weekly" || value === "monthly";
}

export async function listActiveReminderBuckets(userId: string) {
  const now = new Date();
  const rows = await db
    .select({
      id: journalReminders.id,
      entryDate: journalReminders.entryDate,
      entryId: journalReminders.entryId,
      title: journalReminders.title,
      body: journalReminders.body,
      sourceText: journalReminders.sourceText,
      selectionAnchor: journalReminders.selectionAnchor,
      contactId: journalReminders.contactId,
      contactName: contacts.name,
      status: journalReminders.status,
      dueAt: journalReminders.dueAt,
      repeatRule: journalReminders.repeatRule,
      lastTriggeredAt: journalReminders.lastTriggeredAt,
      completedAt: journalReminders.completedAt,
      dismissedAt: journalReminders.dismissedAt,
      createdAt: journalReminders.createdAt,
      updatedAt: journalReminders.updatedAt,
    })
    .from(journalReminders)
    .leftJoin(contacts, eq(journalReminders.contactId, contacts.id))
    .where(and(eq(journalReminders.userId, userId), eq(journalReminders.status, "active")))
    .orderBy(asc(journalReminders.dueAt));

  return {
    overdue: rows.filter((row) => row.dueAt < now),
    upcoming: rows.filter((row) => row.dueAt >= now),
  };
}
