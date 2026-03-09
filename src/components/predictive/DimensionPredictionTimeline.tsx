"use client";

import { useState } from "react";
import type { PredictiveBenchmarkRun } from "@/hooks/predictiveTypes";

const CORE10_DIMENSIONS = [
  "emotionalIntensity",
  "valence",
  "decision",
  "relationship",
  "uncertainty",
  "belief",
  "action",
  "calm",
  "stress",
  "novelty",
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function DimensionPredictionTimeline({
  run,
  selectedCheckpoint,
}: {
  run: PredictiveBenchmarkRun | null;
  selectedCheckpoint?: number | null;
}) {
  const [dimensionIndex, setDimensionIndex] = useState(0);

  const checkpointSize =
    !run?.windowPredictions?.length
      ? selectedCheckpoint ?? null
      : (selectedCheckpoint ??
        run.windowPredictions[run.windowPredictions.length - 1]?.checkpointSize ??
        null);

  const timeline =
    !run?.windowPredictions?.length || !checkpointSize
      ? []
      : [...run.windowPredictions]
          .filter((windowPrediction) => windowPrediction.checkpointSize === checkpointSize)
          .sort(
            (a, b) =>
              a.targetEntryDate.localeCompare(b.targetEntryDate) ||
              a.sampleIndex - b.sampleIndex
          )
          .map((windowPrediction) => ({
            sampleIndex: windowPrediction.sampleIndex,
            targetEntryDate: windowPrediction.targetEntryDate,
            predicted: clamp(
              toNumber(windowPrediction.predictedVector[dimensionIndex], 0),
              0,
              1
            ),
            actual: clamp(toNumber(windowPrediction.actualVector[dimensionIndex], 0), 0, 1),
            baseline: clamp(
              toNumber(windowPrediction.baselineVector[dimensionIndex], 0),
              0,
              1
            ),
          }));

  if (!run) {
    return (
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Dimension Timeline</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Select a benchmark run to inspect per-dimension predictions.</p>
      </section>
    );
  }

  if (!run.windowPredictions?.length) {
    return (
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Dimension Timeline</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Window-level predictions are not available for this run.
        </p>
      </section>
    );
  }

  if (!timeline.length || !checkpointSize) {
    return (
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Dimension Timeline</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">No sampled windows for the selected checkpoint.</p>
      </section>
    );
  }

  const modelMae =
    timeline.reduce((sum, point) => sum + Math.abs(point.predicted - point.actual), 0) /
    Math.max(1, timeline.length);
  const baselineMae =
    timeline.reduce((sum, point) => sum + Math.abs(point.baseline - point.actual), 0) /
    Math.max(1, timeline.length);
  const maeGainPct = baselineMae > 1e-9 ? (baselineMae - modelMae) / baselineMae : 0;

  const width = 920;
  const height = 320;
  const left = 44;
  const right = 18;
  const top = 22;
  const bottom = 44;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  const yMin = 0;
  const yMax = 1;
  const xRange = Math.max(1, timeline.length - 1);
  const toX = (index: number) => left + (index / xRange) * chartWidth;
  const toY = (value: number) => top + (1 - (value - yMin) / (yMax - yMin)) * chartHeight;

  const predictedPoints = timeline.map((point, index) => ({
    x: toX(index),
    y: toY(point.predicted),
  }));
  const actualPoints = timeline.map((point, index) => ({
    x: toX(index),
    y: toY(point.actual),
  }));
  const baselinePoints = timeline.map((point, index) => ({
    x: toX(index),
    y: toY(point.baseline),
  }));

  const firstLabel = formatDateLabel(timeline[0]?.targetEntryDate ?? "");
  const midLabel = formatDateLabel(timeline[Math.floor((timeline.length - 1) / 2)]?.targetEntryDate ?? "");
  const lastLabel = formatDateLabel(timeline[timeline.length - 1]?.targetEntryDate ?? "");

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Dimension Timeline</p>
        <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          checkpoint k = {checkpointSize}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CORE10_DIMENSIONS.map((dimension, index) => (
          <button
            key={dimension}
            type="button"
            onClick={() => setDimensionIndex(index)}
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors ${
              index === dimensionIndex
                ? "border-[var(--amber)] bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-medium)]"
            }`}
          >
            {dimension}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span>windows: {timeline.length}</span>
        <span>model MAE: {modelMae.toFixed(4)}</span>
        <span>baseline MAE: {baselineMae.toFixed(4)}</span>
        <span>MAE gain: {(maeGainPct * 100).toFixed(1)}%</span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[290px] min-w-[760px] w-full rounded-2xl bg-[var(--bg-elevated)]"
        >
          <line
            x1={left}
            y1={height - bottom}
            x2={width - right}
            y2={height - bottom}
            stroke="var(--border-medium)"
            strokeWidth={1}
          />
          <line
            x1={left}
            y1={top}
            x2={left}
            y2={height - bottom}
            stroke="var(--border-medium)"
            strokeWidth={1}
          />

          <path
            d={buildPath(actualPoints)}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <path
            d={buildPath(predictedPoints)}
            fill="none"
            stroke="var(--amber)"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <path
            d={buildPath(baselinePoints)}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth={1.6}
            strokeDasharray="5 5"
          />

          <text x={left} y={12} fill="var(--text-muted)" fontSize="10">
            1.0
          </text>
          <text x={left} y={height - bottom - 4} fill="var(--text-muted)" fontSize="10">
            0.0
          </text>

          <text x={left} y={height - bottom + 18} fill="var(--text-muted)" fontSize="10">
            {firstLabel}
          </text>
          <text
            x={left + chartWidth / 2}
            y={height - bottom + 18}
            fill="var(--text-muted)"
            fontSize="10"
            textAnchor="middle"
          >
            {midLabel}
          </text>
          <text
            x={width - right}
            y={height - bottom + 18}
            fill="var(--text-muted)"
            fontSize="10"
            textAnchor="end"
          >
            {lastLabel}
          </text>
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 bg-[var(--text-primary)]" />
          actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 bg-[var(--amber)]" />
          model
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 bg-[var(--text-muted)]" />
          baseline
        </span>
      </div>
    </section>
  );
}
