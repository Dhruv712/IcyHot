import type { PredictiveBenchmarkPoint, PredictiveBenchmarkRun } from "@/hooks/predictiveTypes";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function CheckpointInspector({
  run,
  point,
}: {
  run: PredictiveBenchmarkRun | null;
  point: PredictiveBenchmarkPoint | null;
}) {
  if (!run || !point) {
    return (
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Checkpoint Inspector</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Select a benchmark run and checkpoint.</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Checkpoint Inspector
        </p>
        <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          k = {point.checkpointSize}
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">MAE</p>
          <p className="mt-1 text-base font-medium text-[var(--text-primary)]">{point.mae.toFixed(4)}</p>
          <p className="text-xs text-[var(--text-muted)]">baseline {point.baselineMae.toFixed(4)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">MSE</p>
          <p className="mt-1 text-base font-medium text-[var(--text-primary)]">{point.mse.toFixed(4)}</p>
          <p className="text-xs text-[var(--text-muted)]">baseline {point.baselineMse.toFixed(4)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Directional</p>
          <p className="mt-1 text-base font-medium text-[var(--text-primary)]">{formatPercent(point.directionalHitRate)}</p>
          <p className="text-xs text-[var(--text-muted)]">baseline {formatPercent(point.baselineDirectionalHitRate)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Delta</p>
          <p className="mt-1 text-base font-medium text-[var(--text-primary)]">
            MAE {formatPercent(point.maeGainPct)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Dir {formatPercent(point.directionalGainPct)}
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <th className="pb-2 pr-3">Dimension</th>
              <th className="pb-2 pr-3">MAE</th>
              <th className="pb-2 pr-3">Baseline MAE</th>
              <th className="pb-2 pr-3">MAE Gain</th>
              <th className="pb-2 pr-3">Directional</th>
              <th className="pb-2 pr-2">Directional Gain</th>
            </tr>
          </thead>
          <tbody>
            {point.perDimension.dimensions.map((dimension) => (
              <tr key={dimension.index} className="border-b border-[var(--border-subtle)]/70 text-[var(--text-secondary)]">
                <td className="py-2 pr-3">{dimension.name}</td>
                <td className="py-2 pr-3">{dimension.mae.toFixed(4)}</td>
                <td className="py-2 pr-3">{dimension.baselineMae.toFixed(4)}</td>
                <td className="py-2 pr-3">{formatPercent(dimension.maeGainPct)}</td>
                <td className="py-2 pr-3">{formatPercent(dimension.directionalHitRate)}</td>
                <td className="py-2 pr-2">{formatPercent(dimension.directionalGainPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
