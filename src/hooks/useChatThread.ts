"use client";

import { useQuery } from "@tanstack/react-query";
import type { ChatMessage, ChatThread } from "@/lib/chat/types";

async function readApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return text.slice(0, 200) || fallback;
  }
}

export interface ChatThreadPayload {
  thread: ChatThread;
  messages: ChatMessage[];
}

export function useChatThread(threadId?: string) {
  return useQuery<ChatThreadPayload>({
    queryKey: ["chat-thread", threadId],
    enabled: Boolean(threadId),
    queryFn: async () => {
      const res = await fetch(`/api/chat/threads/${threadId}`);
      if (!res.ok) throw new Error(await readApiError(res, "Failed to fetch chat thread"));
      return res.json();
    },
    staleTime: 5 * 1000,
  });
}
