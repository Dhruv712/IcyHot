import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getThreadForUser, listMessagesForThread, mapThreadRow } from "@/lib/chat/store";

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const thread = await getThreadForUser(id, session.user.id);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const messages = await listMessagesForThread(id, session.user.id);
    return NextResponse.json({
      thread: mapThreadRow(thread),
      messages,
    });
  } catch (error) {
    console.error(`[chat/thread/${id}] load failed:`, error);
    return NextResponse.json(
      {
        error: isChatStorageError(error)
          ? "Chat storage is not ready yet. Run migration 0007_chat_threads.sql."
          : error instanceof Error
            ? error.message
            : "Failed to fetch chat thread",
      },
      { status: 500 },
    );
  }
}
