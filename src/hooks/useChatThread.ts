"use client";

import { useQuery } from "@tanstack/react-query";
import type { ChatMessage, ChatThread } from "@/lib/chat/types";

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
      if (!res.ok) throw new Error("Failed to fetch chat thread");
      return res.json();
    },
    staleTime: 5 * 1000,
  });
}
