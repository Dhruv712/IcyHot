import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { listThreadsForUser, mapThreadRow } from "@/lib/chat/store";

export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threads = await listThreadsForUser(session.user.id);
  return NextResponse.json({ threads });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
}
