"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import BenchmarkCurve from "@/components/predictive/BenchmarkCurve";
import BenchmarkHistoryTable from "@/components/predictive/BenchmarkHistoryTable";
import BenchmarkRunControls from "@/components/predictive/BenchmarkRunControls";
import CheckpointInspector from "@/components/predictive/CheckpointInspector";
import DimensionPredictionTimeline from "@/components/predictive/DimensionPredictionTimeline";
import LearningSummaryCard from "@/components/predictive/LearningSummaryCard";
import PredictiveStatusCard from "@/components/predictive/PredictiveStatusCard";
import {
  usePredictiveBenchmarkRun,
  usePredictiveBenchmarkRuns,
} from "@/hooks/usePredictiveBenchmarks";
import type { PredictiveBenchmarkPoint, PredictiveBenchmarkRun } from "@/hooks/predictiveTypes";
import { usePredictiveOverview } from "@/hooks/usePredictiveOverview";
import { useRunPredictiveBenchmark } from "@/hooks/useRunPredictiveBenchmark";

function setQueryParam(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
  key: string,
  value: string | null
) {
  const next = new URLSearchParams(searchParams.toString());
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  router.replace(query ? `${pathname}?${query}` : pathname);
}

export default function PredictivePlaygroundPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedRunId = searchParams.get("run");
  const selectedCheckpointParam = searchParams.get("checkpoint");
  const selectedCheckpoint = selectedCheckpointParam ? Number(selectedCheckpointParam) : null;

  const overviewQuery = usePredictiveOverview();
  const runsQuery = usePredictiveBenchmarkRuns(20, 0);
  const activeRunQuery = usePredictiveBenchmarkRun(selectedRunId ?? undefined);
  const runBenchmark = useRunPredictiveBenchmark();

  const overview = overviewQuery.data;
  const runs = useMemo(
    () => runsQuery.data?.runs ?? overview?.recentRuns ?? [],
    [overview?.recentRuns, runsQuery.data?.runs]
  );

  useEffect(() => {
    if (selectedRunId || !runs.length) return;
    setQueryParam(router, pathname, searchParams, "run", runs[0].id);
  }, [pathname, router, runs, searchParams, selectedRunId]);

  const activeRun: PredictiveBenchmarkRun | null = useMemo(() => {
    if (activeRunQuery.data) return activeRunQuery.data;
    if (!selectedRunId) return overview?.latestRun ?? null;
    return runs.find((run) => run.id === selectedRunId) ?? null;
  }, [activeRunQuery.data, overview?.latestRun, runs, selectedRunId]);

  const activePoints: PredictiveBenchmarkPoint[] = useMemo(
    () =>
      activeRun && Array.isArray(activeRun.points)
        ? activeRun.points
        : overview?.latestRun?.points ?? [],
    [activeRun, overview?.latestRun?.points]
  );

  useEffect(() => {
    if (!activePoints.length) return;
    if (selectedCheckpoint && activePoints.some((point) => point.checkpointSize === selectedCheckpoint)) return;
    const fallback = activePoints[activePoints.length - 1];
    if (!fallback) return;
    setQueryParam(router, pathname, searchParams, "checkpoint", String(fallback.checkpointSize));
  }, [activePoints, pathname, router, searchParams, selectedCheckpoint]);

  const selectedPoint =
    activePoints.find((point) => point.checkpointSize === selectedCheckpoint) ??
    activePoints[activePoints.length - 1] ??
    null;

  const loading = overviewQuery.isLoading || runsQuery.isLoading;
  const pageError =
    overviewQuery.error?.message ||
    runsQuery.error?.message ||
    activeRunQuery.error?.message ||
    runBenchmark.error?.message ||
    null;

  const disabledReason = useMemo(() => {
    const frames = overview?.status.framesCount ?? 0;
    if (!overview) return "Loading predictive status...";
    if (!overview.status.backfillCompleteAt) {
      return "Backfill is not complete yet. Run nightly sync to generate journal state frames.";
    }
    if (frames < 2) {
      return `Need at least 2 state frames to benchmark. Current: ${frames}.`;
    }
    return null;
  }, [overview]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
        <header className="px-1">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Predictive Playground</p>
          <h1 className="mt-1 text-2xl font-medium text-[var(--text-primary)]">Learning visibility and benchmarking</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            Evaluate next-entry prediction quality across progressive checkpoints and compare against persistence baseline.
          </p>
        </header>

        {pageError && (
          <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-4 py-3 text-sm text-[var(--danger)]">
            {pageError}
          </div>
        )}

        {loading || !overview ? (
          <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-6 text-sm text-[var(--text-secondary)]">
            Loading predictive playground...
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <PredictiveStatusCard overview={overview} />
              <LearningSummaryCard learningSummary={overview.learningSummary} />
            </div>

            <BenchmarkRunControls
              disabledReason={disabledReason}
              progress={runBenchmark.progress}
              running={runBenchmark.isPending || runBenchmark.progress.status === "running"}
              onRunQuick={() => runBenchmark.mutate({ mode: "quick" })}
              onRunFull={() => runBenchmark.mutate({ mode: "full" })}
            />

            <BenchmarkCurve
              points={activePoints}
              selectedCheckpoint={selectedCheckpoint}
              onSelectCheckpoint={(checkpointSize) =>
                setQueryParam(router, pathname, searchParams, "checkpoint", String(checkpointSize))
              }
            />

            <div className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr]">
              <BenchmarkHistoryTable
                runs={runs}
                selectedRunId={activeRun?.id}
                onSelectRun={(runId) => {
                  const next = new URLSearchParams(searchParams.toString());
                  next.set("run", runId);
                  next.delete("checkpoint");
                  const query = next.toString();
                  router.replace(query ? `${pathname}?${query}` : pathname);
                }}
              />
              <CheckpointInspector run={activeRun} point={selectedPoint} />
            </div>

            <DimensionPredictionTimeline run={activeRun} selectedCheckpoint={selectedCheckpoint} />
          </>
        )}
      </div>
    </div>
  );
}
