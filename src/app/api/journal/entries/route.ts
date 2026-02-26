import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listJournalFiles, parseJournalDate } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET — List all journal entries with parsed dates.
 * Returns: { entries: [{ filename, date, name }] } sorted most recent first.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await listJournalFiles();

    const entries = files
      .map((f) => {
        const date = parseJournalDate(f.name);
        return date
          ? { filename: f.name, date, name: f.name.replace(/\.md$/, "") }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b!.date.localeCompare(a!.date));

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[journal-entries] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list entries" },
      { status: 500 }
    );
  }
}
