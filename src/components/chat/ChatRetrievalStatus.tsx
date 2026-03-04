import type { ChatRetrievalStats } from "@/lib/chat/types";

export default function ChatRetrievalStatus({
  stats,
  searching = false,
}: {
  stats: ChatRetrievalStats | null;
  searching?: boolean;
}) {
  if (!stats && !searching) return null;

  return (
    <div className="mb-3 inline-flex flex-wrap items-center gap-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
      {searching && !stats ? (
        <span>Searching...</span>
      ) : (
        <>
          <span>Memories {stats?.memories ?? 0}</span>
          <span>Implications {stats?.implications ?? 0}</span>
          <span>Connections {stats?.connections ?? 0}</span>
        </>
      )}
    </div>
  );
}
