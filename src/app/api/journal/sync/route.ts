import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncJournalEntries } from "@/lib/journal";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncJournalEntries(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Journal sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Journal sync failed" },
      { status: 500 }
    );
  }
}
