import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { chatMessages, chatThreads } from "@/db/schema";
import { streamChatAnswer, buildThreadTitle, getChatModel } from "@/lib/chat/answer";
import { buildChatRetrievalStats, buildChatSources } from "@/lib/chat/retrieval";
import { getThreadForUser, listMessagesForThread } from "@/lib/chat/store";
import { retrieveMemories } from "@/lib/memory/retrieve";
import type { ChatSourcesPayload, ChatStreamEvent } from "@/lib/chat/types";

export const maxDuration = 60;

function emit(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: ChatStreamEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

export async function POST(
  request: NextRequest,
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

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const history = await listMessagesForThread(id, session.user.id);
  const now = new Date();
  const [userMessage] = await db
    .insert(chatMessages)
    .values({
      threadId: id,
      userId: session.user.id,
      role: "user",
      content,
      status: "complete",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const [assistantMessage] = await db
    .insert(chatMessages)
    .values({
      threadId: id,
      userId: session.user.id,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const threadTitle = thread.title === "New chat" ? buildThreadTitle(content) : thread.title;
  await db
    .update(chatThreads)
    .set({
      title: threadTitle,
      updatedAt: now,
      lastMessageAt: now,
    })
    .where(and(eq(chatThreads.id, id), eq(chatThreads.userId, session.user.id)));

  const encoder = new TextEncoder();
  const model = getChatModel();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantContent = "";
      let sources: ChatSourcesPayload | null = null;
      let stats = null;

      try {
        emit(controller, encoder, {
          type: "message_saved",
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
        });

        emit(controller, encoder, { type: "retrieval_started" });

        const retrieval = await retrieveMemories(session.user.id, content, {
          maxMemories: 14,
          maxHops: 2,
          diversify: true,
          skipHebbian: true,
        });

        stats = buildChatRetrievalStats(retrieval);
        sources = buildChatSources(retrieval);

        emit(controller, encoder, {
          type: "retrieval_complete",
          stats,
          sources,
        });

        emit(controller, encoder, {
          type: "generation_started",
          model,
        });

        const answerStream = streamChatAnswer({
          question: content,
          history: history.map((message) => ({ role: message.role, content: message.content })),
          retrieval,
        });

        answerStream.on("text", (delta) => {
          assistantContent += delta;
          emit(controller, encoder, { type: "token", text: delta });
        });

        await answerStream.finalMessage();

        const completedAt = new Date();
        await db
          .update(chatMessages)
          .set({
            content: assistantContent.trim(),
            status: "complete",
            model,
            retrievalStats: stats,
            sources,
            errorMessage: null,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(chatMessages.id, assistantMessage.id),
              eq(chatMessages.threadId, id),
              eq(chatMessages.userId, session.user.id),
            ),
          );

        await db
          .update(chatThreads)
          .set({ updatedAt: completedAt, lastMessageAt: completedAt })
          .where(and(eq(chatThreads.id, id), eq(chatThreads.userId, session.user.id)));

        emit(controller, encoder, {
          type: "complete",
          assistantMessageId: assistantMessage.id,
          content: assistantContent.trim(),
          stats: stats ?? { memories: 0, implications: 0, connections: 0 },
        });
      } catch (error) {
        const failedAt = new Date();
        const message = error instanceof Error ? error.message : "Failed to generate response";

        await db
          .update(chatMessages)
          .set({
            content: assistantContent.trim(),
            status: "error",
            model,
            retrievalStats: stats,
            sources,
            errorMessage: message,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(chatMessages.id, assistantMessage.id),
              eq(chatMessages.threadId, id),
              eq(chatMessages.userId, session.user.id),
            ),
          );

        await db
          .update(chatThreads)
          .set({ updatedAt: failedAt, lastMessageAt: failedAt })
          .where(and(eq(chatThreads.id, id), eq(chatThreads.userId, session.user.id)));

        emit(controller, encoder, {
          type: "error",
          message,
          assistantMessageId: assistantMessage.id,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
