"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatStreamEvent, ChatThread, ChatThreadSummary } from "@/lib/chat/types";
import type { ChatThreadPayload } from "./useChatThread";

function nowIso(): string {
  return new Date().toISOString();
}

function applyThreadPreview(
  threads: { threads: ChatThreadSummary[] } | undefined,
  threadId: string,
  preview: string,
) {
  if (!threads) return threads;
  return {
    threads: threads.threads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            preview,
            updatedAt: nowIso(),
            lastMessageAt: nowIso(),
            title: thread.title === "New chat" ? preview.slice(0, 60) || "New chat" : thread.title,
          }
        : thread,
    ),
  };
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { threadId: string; content: string; thread?: ChatThread }>({
    mutationFn: async ({ threadId, content, thread }) => {

      const trimmed = content.trim();
      if (!trimmed) return;

      const tempUserId = `temp-user-${Date.now()}`;
      const tempAssistantId = `temp-assistant-${Date.now()}`;
      const createdAt = nowIso();
      const markAssistantError = (message: string) => {
        queryClient.setQueryData<ChatThreadPayload | undefined>(
          ["chat-thread", threadId],
          (existing) => {
            if (!existing) {
              return {
                thread: thread ?? {
                  id: threadId,
                  title: "New chat",
                  createdAt,
                  updatedAt: createdAt,
                  lastMessageAt: createdAt,
                },
                messages: [],
              };
            }
            return {
              ...existing,
              messages: existing.messages.map((entry) =>
                entry.id === tempAssistantId || entry.status === "streaming"
                  ? {
                      ...entry,
                      status: "error",
                      errorMessage: message,
                    }
                  : entry,
              ),
            };
          },
        );
      };

      queryClient.setQueryData<ChatThreadPayload | undefined>(
        ["chat-thread", threadId],
        (existing) => {
          const base: ChatThreadPayload =
            existing ?? {
              thread: thread ?? {
                id: threadId,
                title: "New chat",
                createdAt,
                updatedAt: createdAt,
                lastMessageAt: createdAt,
              },
              messages: [],
            };

          return {
            ...base,
            messages: [
              ...base.messages,
              {
                id: tempUserId,
                threadId,
                role: "user",
                content: trimmed,
                status: "complete",
                model: null,
                retrievalStats: null,
                sources: null,
                errorMessage: null,
                createdAt,
              },
              {
                id: tempAssistantId,
                threadId,
                role: "assistant",
                content: "",
                status: "streaming",
                model: null,
                retrievalStats: null,
                sources: null,
                errorMessage: null,
                createdAt,
              },
            ],
          };
        },
      );

      queryClient.setQueryData<{ threads: ChatThreadSummary[] } | undefined>(
        ["chat-threads"],
        (existing) => applyThreadPreview(existing, threadId, trimmed),
      );

      const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        const errorMessage = data.error || "Failed to send chat message";
        markAssistantError(errorMessage);
        throw new Error(errorMessage);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const applyEvent = (event: ChatStreamEvent) => {
        queryClient.setQueryData<ChatThreadPayload | undefined>(
          ["chat-thread", threadId],
          (existing) => {
            if (!existing) return existing;

            switch (event.type) {
              case "message_saved":
                return {
                  ...existing,
                  messages: existing.messages.map((message) => {
                    if (message.id === tempUserId) {
                      return { ...message, id: event.userMessageId };
                    }
                    if (message.id === tempAssistantId) {
                      return { ...message, id: event.assistantMessageId };
                    }
                    return message;
                  }),
                };
              case "retrieval_complete":
                return {
                  ...existing,
                  messages: existing.messages.map((message) =>
                    message.id === tempAssistantId || message.status === "streaming"
                      ? {
                          ...message,
                          retrievalStats: event.stats,
                          sources: event.sources,
                        }
                      : message,
                  ),
                };
              case "generation_started":
                return {
                  ...existing,
                  messages: existing.messages.map((message) =>
                    message.id === tempAssistantId || message.status === "streaming"
                      ? {
                          ...message,
                          model: event.model,
                        }
                      : message,
                  ),
                };
              case "token":
                return {
                  ...existing,
                  messages: existing.messages.map((message) =>
                    message.id === tempAssistantId || message.status === "streaming"
                      ? {
                          ...message,
                          content: `${message.content}${event.text}`,
                        }
                      : message,
                  ),
                };
              case "complete":
                return {
                  ...existing,
                  messages: existing.messages.map((message) =>
                    message.id === tempAssistantId || message.id === event.assistantMessageId || message.status === "streaming"
                      ? {
                          ...message,
                          id: event.assistantMessageId,
                          content: event.content,
                          retrievalStats: event.stats,
                          status: "complete",
                        }
                      : message,
                  ),
                };
              case "error":
                return {
                  ...existing,
                  messages: existing.messages.map((message) =>
                    message.id === tempAssistantId || message.id === event.assistantMessageId || message.status === "streaming"
                      ? {
                          ...message,
                          status: "error",
                          errorMessage: event.message,
                        }
                      : message,
                  ),
                };
              default:
                return existing;
            }
          },
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          applyEvent(JSON.parse(trimmedLine) as ChatStreamEvent);
        }
      }

      if (buffer.trim()) {
        applyEvent(JSON.parse(buffer.trim()) as ChatStreamEvent);
      }

      queryClient.invalidateQueries({ queryKey: ["chat-thread", threadId] });
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
    },
    onError: (error, variables) => {
      const threadId = variables.threadId;
      queryClient.invalidateQueries({ queryKey: ["chat-thread", threadId] });
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      console.error("[chat] send failed:", error);
    },
  });
}
