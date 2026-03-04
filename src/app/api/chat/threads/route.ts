import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { listThreadsForUser, mapThreadRow } from "@/lib/chat/store";

export const maxDuration = 30;

function isChatStorageError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("chat_threads") ||
    message.includes("chat_messages") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    message.includes("undefined table")
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const threads = await listThreadsForUser(session.user.id);
    return NextResponse.json({ threads });
  } catch (error) {
    console.error("[chat/threads] list failed:", error);
    return NextResponse.json(
      {
        error: isChatStorageError(error)
          ? "Chat storage is not ready yet. Run migration 0007_chat_threads.sql."
          : error instanceof Error
            ? error.message
            : "Failed to fetch chat threads",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const [thread] = await db
      .insert(chatThreads)
      .values({
        userId: session.user.id,
        title: "New chat",
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
      })
      .returning();

    return NextResponse.json({ thread: mapThreadRow(thread) }, { status: 201 });
  } catch (error) {
    console.error("[chat/threads] create failed:", error);
    return NextResponse.json(
      {
        error: isChatStorageError(error)
          ? "Chat storage is not ready yet. Run migration 0007_chat_threads.sql."
          : error instanceof Error
            ? error.message
            : "Failed to create chat thread",
      },
      { status: 500 },
    );
  }
}
