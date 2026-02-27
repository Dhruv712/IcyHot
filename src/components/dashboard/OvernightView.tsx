"use client";

import { useLatestConsolidationDigest } from "@/hooks/useConsolidation";
import BriefingSection from "./BriefingSection";

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(dateIso: string): string {
  return new Date(dateIso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3 text-center">
      <div className="text-lg font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );
}

export default function OvernightView() {
  const { data, isLoading } = useLatestConsolidationDigest();

  if (isLoading) {
    return (
      <div className="max-w-[640px] mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--bg-elevated)] rounded w-48" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded w-full" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded w-3/4" />
        </div>
      </div>
    );
  }

  const digest = data?.digest;

  if (!digest) {
    return (
      <div className="max-w-[640px] mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-sm text-[var(--text-muted)]">
            No overnight consolidation update yet. After your next nightly run, connections and implications will appear here.
          </p>
        </div>
      </div>
    );
  }

  const createdConnections = digest.details.createdConnections ?? [];
  const strengthenedConnections = digest.details.strengthenedConnections ?? [];
  const createdImplications = digest.details.createdImplications ?? [];
  const reinforcedImplications = digest.details.reinforcedImplications ?? [];

  return (
    <div className="max-w-[640px] mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-lg font-medium text-[var(--text-primary)] tracking-tight">
          Overnight update for {formatDay(digest.digestDate)}
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
          {digest.summary}
        </p>
        <p className="text-[11px] text-[var(--text-muted)] mt-1">
          Completed at {formatTime(digest.runCompletedAt)} ({digest.timeZone})
        </p>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-[var(--amber)]/30 to-transparent" />

      <BriefingSection title="What changed" icon="✨">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="New links" value={digest.counts.connectionsCreated} />
          <Stat label="Stronger links" value={digest.counts.connectionsStrengthened} />
          <Stat label="New insights" value={digest.counts.implicationsCreated} />
          <Stat label="Reinforced" value={digest.counts.implicationsReinforced} />
        </div>
      </BriefingSection>

      {createdImplications.length > 0 && (
        <BriefingSection title="New implications" icon="🧠">
          <div className="space-y-3">
            {createdImplications.map((imp) => (
              <div key={imp.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">{imp.content}</p>
                {imp.sourceMemorySnippets.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {imp.sourceMemorySnippets.slice(0, 2).map((source) => (
                      <p key={source.id} className="text-xs text-[var(--text-muted)] leading-relaxed">
                        {source.sourceDate}: &ldquo;{source.snippet}&rdquo;
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {createdConnections.length > 0 && (
        <BriefingSection title="New memory links" icon="🔗">
          <div className="space-y-3">
            {createdConnections.map((conn) => (
              <div key={conn.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {conn.reason || "A new connection was identified between two memories."}
                </p>
                <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                  <p>{conn.memoryADate}: &ldquo;{conn.memoryASnippet}&rdquo;</p>
                  <p>{conn.memoryBDate}: &ldquo;{conn.memoryBSnippet}&rdquo;</p>
                </div>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {strengthenedConnections.length > 0 && (
        <BriefingSection title="Strengthened links" icon="📈">
          <div className="space-y-2">
            {strengthenedConnections.map((conn) => (
              <div key={conn.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {conn.reason || "Existing memory link reinforced."}
                </p>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {reinforcedImplications.length > 0 && (
        <BriefingSection title="Reinforced implications" icon="🪄">
          <div className="space-y-2">
            {reinforcedImplications.map((imp) => (
              <div key={imp.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{imp.content}</p>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}
    </div>
  );
}
