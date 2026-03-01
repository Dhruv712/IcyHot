import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalDrafts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { journalFilename, getJournalFileContent, getJournalFileSha } from "@/lib/github";
import { getDateStringInTimeZone } from "@/lib/timezone";
import { getUserTimeZone } from "@/lib/userTimeZone";

export const maxDuration = 30;

/**
 * GET — Load a journal entry for a given date (defaults to today).
 * Reads from Neon draft first, falls back to GitHub for old entries.
 * ?date=2026-02-25
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const timeZone = await getUserTimeZone(session.user.id);
  const entryDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : getDateStringInTimeZone(new Date(), timeZone);
  const d = new Date(`${entryDate}T12:00:00`);
  const filename = journalFilename(d);

  try {
    // 1. Check Neon draft first
    const [draft] = await db
      .select()
      .from(journalDrafts)
      .where(
        and(
          eq(journalDrafts.userId, session.user.id),
          eq(journalDrafts.entryDate, entryDate)
        )
      )
      .limit(1);

    if (draft) {
      return NextResponse.json({
        filename,
        content: draft.content,
        contentJson: draft.contentJson,
        entryDate,
        exists: true,
        source: "db",
      });
    }

    // 2. Fall back to GitHub for entries not yet in the DB
    const sha = await getJournalFileSha(filename);
    if (!sha) {
      return NextResponse.json({
        filename,
        content: "",
        contentJson: null,
        entryDate,
        exists: false,
        source: "new",
      });
    }

    const content = await getJournalFileContent(`Journals/${filename}`);

    // 3. Backfill into the DB so we don't hit GitHub again
    await db
      .insert(journalDrafts)
      .values({
        userId: session.user.id,
        entryDate,
        content,
        contentJson: null,
        githubSha: sha,
        committedToGithubAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    return NextResponse.json({
      filename,
      content,
      contentJson: null,
      entryDate,
      exists: true,
      source: "github",
    });
  } catch (error) {
    console.error("[journal-save] Load error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load journal" },
      { status: 500 }
    );
  }
}

/**
 * POST — Autosave a journal entry to Neon DB.
 * Body: { content: string, entryDate: string }
 *
 * This is fast (just a DB upsert). GitHub commit happens via daily cron.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { content, contentJson, entryDate } = await request.json();

    if (!content || !entryDate) {
      return NextResponse.json(
        { error: "content and entryDate are required" },
        { status: 400 }
      );
    }

    // Upsert draft — update content + updatedAt on conflict
    const [result] = await db
      .insert(journalDrafts)
      .values({
        userId: session.user.id,
        entryDate,
        content,
        contentJson: contentJson ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [journalDrafts.userId, journalDrafts.entryDate],
        set: {
          content,
          contentJson: contentJson ?? null,
          updatedAt: new Date(),
        },
        setWhere: and(
          eq(journalDrafts.userId, session.user.id),
          eq(journalDrafts.entryDate, entryDate)
        ),
      })
      .returning({ id: journalDrafts.id, updatedAt: journalDrafts.updatedAt });

    return NextResponse.json({
      saved: true,
      updatedAt: result.updatedAt,
      contentJson: contentJson ?? null,
    });
  } catch (error) {
    console.error("[journal-save] Save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 500 }
    );
  }
}
