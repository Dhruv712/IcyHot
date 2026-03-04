import type { ChatThreadSummary } from "@/lib/chat/types";

function formatTime(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function ChatThreadList({
  threads,
  activeThreadId,
  onSelect,
  onCreate,
  loading = false,
}: {
  threads: ChatThreadSummary[];
  activeThreadId?: string;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex h-full flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Chat</p>
          <h1 className="mt-1 text-sm font-medium text-[var(--text-primary)]">Saved threads</h1>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="space-y-2 px-2 py-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="px-3 py-6 text-sm text-[var(--text-muted)]">No chats yet.</div>
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === activeThreadId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  className={`w-full rounded-2xl px-3 py-3 text-left transition-colors ${
                    active
                      ? "bg-[var(--amber-ghost-bg)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{thread.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
                        {thread.preview || "No messages yet."}
                      </p>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {formatTime(thread.lastMessageAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
