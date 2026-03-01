import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalDrafts, journalReminders } from "@/db/schema";
import { isValidReminderRepeatRule, listActiveReminderBuckets } from "@/lib/journalReminders";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");
  if (status && status !== "active") {
    return NextResponse.json({ error: "Only active reminders are supported here" }, { status: 400 });
  }

  const buckets = await listActiveReminderBuckets(session.user.id);
  return NextResponse.json(buckets);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    entryDate,
    title,
    body: reminderBody,
    sourceText,
    dueAt,
    repeatRule,
    contactId,
    selectionAnchor,
  } = body as {
    entryDate?: string;
    title?: string;
    body?: string;
    sourceText?: string;
    dueAt?: string;
    repeatRule?: string;
    contactId?: string;
    selectionAnchor?: unknown;
  };

  if (!entryDate || !title?.trim() || !sourceText?.trim() || !dueAt) {
    return NextResponse.json(
      { error: "entryDate, title, sourceText, and dueAt are required" },
      { status: 400 },
    );
  }

  if (!isValidReminderRepeatRule(repeatRule)) {
    return NextResponse.json({ error: "Invalid repeatRule" }, { status: 400 });
  }

  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  }

  const [draft] = await db
    .select({ id: journalDrafts.id })
    .from(journalDrafts)
    .where(
      and(
        eq(journalDrafts.userId, session.user.id),
        eq(journalDrafts.entryDate, entryDate),
      ),
    )
    .limit(1);

  const [reminder] = await db
    .insert(journalReminders)
    .values({
      userId: session.user.id,
      entryDate,
      entryId: draft?.id ?? null,
      title: title.trim(),
      body: reminderBody?.trim() ? reminderBody.trim() : null,
      sourceText: sourceText.trim(),
      selectionAnchor: selectionAnchor ?? null,
      contactId: contactId || null,
      dueAt: dueDate,
      repeatRule,
      status: "active",
      updatedAt: new Date(),
    })
    .returning();

  return NextResponse.json({ reminder }, { status: 201 });
}
