import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getThreadForUser, listMessagesForThread, mapThreadRow } from "@/lib/chat/store";

export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const thread = await getThreadForUser(id, session.user.id);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const messages = await listMessagesForThread(id, session.user.id);
  return NextResponse.json({
    thread: mapThreadRow(thread),
    messages,
  });
}
