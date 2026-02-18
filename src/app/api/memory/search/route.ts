import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { retrieveMemories } from "@/lib/memory/retrieve";

export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { query, contactId, maxMemories, maxHops, skipHebbian } = body as {
    query?: string;
    contactId?: string;
    maxMemories?: number;
    maxHops?: number;
    skipHebbian?: boolean;
  };

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 }
    );
  }

  try {
    const result = await retrieveMemories(session.user.id, query.trim(), {
      maxMemories,
      maxHops,
      contactFilter: contactId,
      skipHebbian,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[memory/search] Error:", error);
    return NextResponse.json(
      {
        error: "Search failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
