import type { PredictiveOverview } from "@/hooks/predictiveTypes";

export default function LearningSummaryCard({
  learningSummary,
}: {
  learningSummary: PredictiveOverview["learningSummary"];
}) {
  if (!learningSummary) {
    return (
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Learning Snapshot</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          No trained artifact available yet.
        </p>
      </section>
    );
  }

  const modelSpecificEntries = Object.entries(learningSummary.modelSpecific ?? {}).slice(0, 6);

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Learning Snapshot</p>
      <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">{learningSummary.summaryText}</p>

      {learningSummary.keySignals.length > 0 && (
        <div className="mt-3 space-y-2">
          {learningSummary.keySignals.map((signal) => (
            <div
              key={signal}
              className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              {signal}
            </div>
          ))}
        </div>
      )}

      {modelSpecificEntries.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] px-3 py-3 text-xs text-[var(--text-muted)]">
          <p className="uppercase tracking-[0.12em]">Model internals</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {modelSpecificEntries.map(([key, value]) => (
              <span key={key}>
                {key}: {typeof value === "number" ? value.toFixed(4) : Array.isArray(value) ? `[${value.length}]` : typeof value === "object" ? "{...}" : String(value)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
