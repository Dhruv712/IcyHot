import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, chatThreads } from "@/db/schema";
import type { ChatMessage, ChatSourcesPayload, ChatThread, ChatThreadSummary, ChatRetrievalStats } from "./types";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

export function mapThreadRow(row: typeof chatThreads.$inferSelect): ChatThread {
  return {
    id: row.id,
    title: row.title,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    lastMessageAt: toIso(row.lastMessageAt),
  };
}

export function mapMessageRow(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    status: row.status,
    model: row.model,
    retrievalStats: parseJson<ChatRetrievalStats>(row.retrievalStats),
    sources: parseJson<ChatSourcesPayload>(row.sources),
    errorMessage: row.errorMessage,
    createdAt: toIso(row.createdAt),
  };
}

export async function getThreadForUser(threadId: string, userId: string) {
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)))
    .limit(1);

  return thread ?? null;
}

export async function listThreadsForUser(userId: string): Promise<ChatThreadSummary[]> {
  const rows = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
      lastMessageAt: chatThreads.lastMessageAt,
      preview: sql<string | null>`(
        SELECT content
        FROM ${chatMessages}
        WHERE ${chatMessages.threadId} = ${chatThreads.id}
        ORDER BY ${chatMessages.createdAt} DESC
        LIMIT 1
      )`,
    })
    .from(chatThreads)
    .where(eq(chatThreads.userId, userId))
    .orderBy(desc(chatThreads.lastMessageAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    lastMessageAt: toIso(row.lastMessageAt),
    preview: row.preview,
  }));
}

export async function listMessagesForThread(threadId: string, userId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.userId, userId)))
    .orderBy(asc(chatMessages.createdAt));

  return rows.map(mapMessageRow);
}
