import type { PredictiveBenchmarkRun } from "@/hooks/predictiveTypes";

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s`;
}

export default function BenchmarkHistoryTable({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  runs: PredictiveBenchmarkRun[];
  selectedRunId?: string | null;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Run History</p>

      {runs.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">No benchmark runs yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                <th className="pb-2 pr-4">Started</th>
                <th className="pb-2 pr-4">Mode</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Checkpoints</th>
                <th className="pb-2 pr-4">Duration</th>
                <th className="pb-2 pr-2">Best MAE</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const bestMae = run.summary?.bestMae as
                  | { mae?: number }
                  | undefined;
                const active = run.id === selectedRunId;

                return (
                  <tr
                    key={run.id}
                    className={`cursor-pointer border-b border-[var(--border-subtle)]/70 transition-colors ${
                      active ? "bg-[var(--amber-ghost-bg)]" : "hover:bg-[var(--bg-elevated)]"
                    }`}
                    onClick={() => onSelectRun(run.id)}
                  >
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{formatDateTime(run.startedAt)}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{run.mode}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] ${
                          run.status === "complete"
                            ? "bg-emerald-500/10 text-emerald-500"
                            : run.status === "error"
                              ? "bg-[var(--danger)]/12 text-[var(--danger)]"
                              : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{run.checkpointSchedule.length}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{formatDuration(run.durationMs)}</td>
                    <td className="py-2 pr-2 text-[var(--text-secondary)]">
                      {typeof bestMae?.mae === "number" ? bestMae.mae.toFixed(4) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
