"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatThread, ChatThreadSummary } from "@/lib/chat/types";

export function useChatThreads() {
  return useQuery<{ threads: ChatThreadSummary[] }>({
    queryKey: ["chat-threads"],
    queryFn: async () => {
      const res = await fetch("/api/chat/threads");
      if (!res.ok) throw new Error("Failed to fetch chat threads");
      return res.json();
    },
    staleTime: 15 * 1000,
  });
}

export function useCreateChatThread() {
  const queryClient = useQueryClient();

  return useMutation<{ thread: ChatThread }>({
    mutationFn: async () => {
      const res = await fetch("/api/chat/threads", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create chat thread");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
    },
  });
}
