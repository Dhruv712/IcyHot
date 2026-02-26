import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getJournalFileContent,
  getJournalFileSha,
  createOrUpdateJournalFile,
  journalFilename,
} from "@/lib/github";
import { syncJournalEntries } from "@/lib/journal";
import { processMemories } from "@/lib/memory/pipeline";

export const maxDuration = 120;

/**
 * GET — Load a journal entry for a given date (defaults to today).
 * ?date=2026-02-25
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const d = dateParam ? new Date(dateParam + "T12:00:00") : new Date();
  const filename = journalFilename(d);

  try {
    const sha = await getJournalFileSha(filename);
    if (!sha) {
      return NextResponse.json({ filename, content: "", sha: null, exists: false });
    }

    const content = await getJournalFileContent(`Journals/${filename}`);
    return NextResponse.json({ filename, content, sha, exists: true });
  } catch (error) {
    console.error("[journal-save] Load error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load journal" },
      { status: 500 }
    );
  }
}

/**
 * POST — Save a journal entry to GitHub, then trigger sync + memory processing.
 * Body: { content: string, filename: string, sha: string | null }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { content, filename, sha } = await request.json();

    if (!content || !filename) {
      return NextResponse.json(
        { error: "content and filename are required" },
        { status: 400 }
      );
    }

    // 1. Save to GitHub
    const result = await createOrUpdateJournalFile(filename, content, sha);

    // 2. Trigger journal sync (processes new entries → interactions, insights, etc.)
    const syncResult = await syncJournalEntries(session.user.id);

    // 3. Trigger memory processing (extracts atomic memories → embeds → stores)
    let memoryResult = { filesProcessed: 0, memoriesCreated: 0, memoriesReinforced: 0, remaining: 0 };
    try {
      memoryResult = await processMemories(session.user.id, { limit: 1, deadlineMs: 60_000 });
    } catch (memError) {
      console.error("[journal-save] Memory processing failed (non-blocking):", memError);
    }

    return NextResponse.json({
      sha: result.sha,
      sync: syncResult,
      memory: memoryResult,
    });
  } catch (error) {
    console.error("[journal-save] Save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 500 }
    );
  }
}
