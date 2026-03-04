"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatComposer from "@/components/chat/ChatComposer";
import ChatLayout from "@/components/chat/ChatLayout";
import ChatMessageList from "@/components/chat/ChatMessageList";
import ChatThreadList from "@/components/chat/ChatThreadList";
import { useCreateChatThread, useChatThreads } from "@/hooks/useChatThreads";
import { useChatThread } from "@/hooks/useChatThread";
import { useSendChatMessage } from "@/hooks/useSendChatMessage";

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedThreadId = searchParams.get("thread") ?? undefined;
  const [showMobileThreads, setShowMobileThreads] = useState(false);
  const autoCreatedRef = useRef(false);

  const { data: threadsData, isLoading: threadsLoading } = useChatThreads();
  const createThread = useCreateChatThread();
  const threads = useMemo(() => threadsData?.threads ?? [], [threadsData?.threads]);

  useEffect(() => {
    if (selectedThreadId || threads.length === 0) return;
    router.replace(`/chat?thread=${threads[0].id}`);
  }, [router, selectedThreadId, threads]);

  useEffect(() => {
    if (selectedThreadId || threadsLoading || threads.length > 0 || autoCreatedRef.current) {
      return;
    }

    autoCreatedRef.current = true;
    void createThread.mutateAsync().then((result) => {
      router.replace(`/chat?thread=${result.thread.id}`);
    });
  }, [createThread, router, selectedThreadId, threads, threadsLoading]);

  const { data: threadData, isLoading: threadLoading } = useChatThread(selectedThreadId);
  const sendMessage = useSendChatMessage(selectedThreadId);
  const readyForChat = Boolean(selectedThreadId) && !createThread.isPending;

  const activeTitle = useMemo(() => {
    if (threadData?.thread.title) return threadData.thread.title;
    if (selectedThreadId) return "Chat";
    return "Memory chat";
  }, [selectedThreadId, threadData?.thread.title]);

  const handleCreateThread = async () => {
    const result = await createThread.mutateAsync();
    router.push(`/chat?thread=${result.thread.id}`);
    setShowMobileThreads(false);
  };

  const handleSelectThread = (threadId: string) => {
    router.push(`/chat?thread=${threadId}`);
    setShowMobileThreads(false);
  };

  const threadRail = (
    <ChatThreadList
      threads={threads}
      activeThreadId={selectedThreadId}
      onSelect={handleSelectThread}
      onCreate={() => void handleCreateThread()}
      loading={threadsLoading}
    />
  );

  return (
    <div className="relative h-full overflow-hidden">
      <ChatLayout
        threadRail={threadRail}
        conversation={(
          <>
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-4 md:px-6">
              <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Chat</p>
                  <h1 className="mt-1 text-lg font-medium text-[var(--text-primary)]">{activeTitle}</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMobileThreads((value) => !value)}
                    className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)] lg:hidden"
                  >
                    Threads
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateThread()}
                    className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
                  >
                    New chat
                  </button>
                </div>
              </div>
            </div>

            {showMobileThreads && (
              <div className="absolute inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setShowMobileThreads(false)}>
                <div className="h-full w-[300px] max-w-[85vw]" onClick={(event) => event.stopPropagation()}>
                  {threadRail}
                </div>
              </div>
            )}

            {threadLoading && selectedThreadId ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
                Loading conversation...
              </div>
            ) : (
              <>
                <ChatMessageList messages={threadData?.messages ?? []} />
                <ChatComposer
                  disabled={!readyForChat || sendMessage.isPending}
                  onSend={async (content) => {
                    if (!selectedThreadId) {
                      return;
                    }
                    await sendMessage.mutateAsync({ content });
                  }}
                />
              </>
            )}
          </>
        )}
      />
    </div>
  );
}
