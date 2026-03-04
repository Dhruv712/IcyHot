import type { ChatSourcesPayload } from "@/lib/chat/types";

export default function ChatSources({ sources }: { sources: ChatSourcesPayload | null }) {
  if (!sources) return null;

  const memoryById = new Map(sources.memories.map((memory) => [memory.id, memory]));

  return (
    <details className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <summary className="cursor-pointer list-none text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        Sources
      </summary>

      <div className="mt-3 space-y-4 text-sm text-[var(--text-secondary)]">
        <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Memories used</h4>
          {sources.memories.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No memories surfaced.</p>
          ) : (
            <div className="space-y-2">
              {sources.memories.map((memory) => (
                <div key={memory.id} className="rounded-xl bg-[var(--bg-card)] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    {memory.date} · score {memory.activationScore.toFixed(3)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--text-primary)]">{memory.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Implications used</h4>
          {sources.implications.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No implications surfaced.</p>
          ) : (
            <div className="space-y-2">
              {sources.implications.map((implication) => (
                <div key={implication.id} className="rounded-xl bg-[var(--bg-card)] px-3 py-2">
                  <p className="text-sm leading-relaxed text-[var(--text-primary)]">{implication.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Connections used</h4>
          {sources.connections.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No connections surfaced.</p>
          ) : (
            <div className="space-y-2">
              {sources.connections.map((connection, index) => {
                const fromMemory = memoryById.get(connection.fromId);
                const toMemory = memoryById.get(connection.toId);
                return (
                  <div key={`${connection.fromId}-${connection.toId}-${index}`} className="rounded-xl bg-[var(--bg-card)] px-3 py-2">
                    <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                      {connection.reason || "A retrieved link between two memories informed this answer."}
                    </p>
                    <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                      {fromMemory && <p>{fromMemory.date}: {fromMemory.snippet}</p>}
                      {toMemory && <p>{toMemory.date}: {toMemory.snippet}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </details>
  );
}
