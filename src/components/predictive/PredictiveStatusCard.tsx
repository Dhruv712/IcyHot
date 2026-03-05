import type { PredictiveOverview } from "@/hooks/predictiveTypes";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export default function PredictiveStatusCard({
  overview,
}: {
  overview: PredictiveOverview;
}) {
  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Model Status</p>
          <h2 className="mt-1 text-lg font-medium text-[var(--text-primary)]">
            {overview.status.activeModelKey ?? overview.selection.modelKey}
            {overview.status.activeModelVersion ? (
              <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                {overview.status.activeModelVersion}
              </span>
            ) : null}
          </h2>
        </div>
        <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          source: {overview.selection.source.replace("_", " ")}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Frames</p>
          <p className="mt-1 text-base font-medium text-[var(--text-primary)]">{overview.status.framesCount}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Backfill</p>
          <p className="mt-1 text-base font-medium text-[var(--text-primary)]">
            {overview.status.backfillCompleteAt ? "complete" : "pending"}
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Last Trained</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {formatDateTime(overview.status.lastTrainedAt)}
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Last Scored</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {formatDateTime(overview.status.lastScoredAt)}
          </p>
        </div>
      </div>

      {overview.latestArtifact && (
        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Artifact Through {overview.latestArtifact.trainedThroughEntryDate}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
            {Object.entries(overview.latestArtifact.metrics).map(([key, value]) => (
              <span key={key}>
                {key}: {typeof value === "number" ? value.toFixed(4).replace(/\.?0+$/, "") : String(value)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
