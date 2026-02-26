import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalDrafts, journalSyncState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseJournalDate } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET — List all journal entries.
 * Merges entries from Neon drafts + journalSyncState.processedFiles (GitHub history).
 * No GitHub API calls needed.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Get all drafts from DB
    const drafts = await db
      .select({ entryDate: journalDrafts.entryDate })
      .from(journalDrafts)
      .where(eq(journalDrafts.userId, session.user.id));

    const dateSet = new Set<string>();
    for (const d of drafts) {
      dateSet.add(d.entryDate);
    }

    // 2. Get processed files from journalSyncState (GitHub history)
    const [syncState] = await db
      .select({ processedFiles: journalSyncState.processedFiles })
      .from(journalSyncState)
      .where(eq(journalSyncState.userId, session.user.id))
      .limit(1);

    if (syncState?.processedFiles) {
      const filenames: string[] = JSON.parse(syncState.processedFiles);
      for (const f of filenames) {
        const date = parseJournalDate(f);
        if (date) dateSet.add(date);
      }
    }

    // 3. Build entries list sorted most recent first
    const entries = Array.from(dateSet)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const d = new Date(date + "T12:00:00");
        const name = d.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        return { date, name };
      });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[journal-entries] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list entries" },
      { status: 500 }
    );
  }
}
