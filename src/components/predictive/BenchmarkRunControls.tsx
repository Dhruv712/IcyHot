import type { PredictiveRunProgressState } from "@/hooks/useRunPredictiveBenchmark";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export default function BenchmarkRunControls({
  disabledReason,
  progress,
  running,
  onRunQuick,
  onRunFull,
}: {
  disabledReason: string | null;
  progress: PredictiveRunProgressState;
  running: boolean;
  onRunQuick: () => void;
  onRunFull: () => void;
}) {
  const canRun = !running && !disabledReason;

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Run Controls</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canRun}
            onClick={onRunQuick}
            className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run quick
          </button>
          <button
            type="button"
            disabled={!canRun}
            onClick={onRunFull}
            className="rounded-full border border-[var(--amber)] bg-[var(--amber-ghost-bg)] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--amber)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run full
          </button>
        </div>
      </div>

      {disabledReason ? (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">{disabledReason}</p>
      ) : (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Quick mode evaluates up to 25 windows per checkpoint. Full mode evaluates up to 200.
        </p>
      )}

      {progress.status !== "idle" && (
        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-muted)]">
            <span>mode: {progress.mode ?? "—"}</span>
            <span>run: {progress.runId ?? "starting..."}</span>
            <span>frames: {progress.frameCount || "—"}</span>
            <span>elapsed: {formatDuration(progress.elapsedMs)}</span>
            <span>status: {progress.status}</span>
          </div>

          {progress.currentCheckpoint && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              checkpoint {progress.currentCheckpoint.checkpointSize} ({progress.currentCheckpoint.checkpointIndex + 1}/
              {progress.currentCheckpoint.checkpointTotal})
            </p>
          )}

          {progress.error && (
            <p className="mt-2 text-sm text-[var(--danger)]">{progress.error}</p>
          )}

          {progress.completedCheckpoints.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
              {progress.completedCheckpoints.map((checkpoint) => (
                <div key={checkpoint.checkpointSize} className="flex items-center justify-between rounded-xl bg-[var(--bg-elevated)] px-2.5 py-1.5">
                  <span>k={checkpoint.checkpointSize}</span>
                  <span>
                    MAE {checkpoint.metrics?.mae.toFixed(4) ?? "—"} · Dir {((checkpoint.metrics?.directionalHitRate ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
