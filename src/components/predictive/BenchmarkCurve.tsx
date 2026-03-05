"use client";

import { useMemo, useState } from "react";
import type { PredictiveBenchmarkPoint } from "@/hooks/predictiveTypes";

type MetricKey =
  | "mae"
  | "mse"
  | "directionalHitRate"
  | "maeGainPct"
  | "directionalGainPct";

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: "mae", label: "MAE" },
  { key: "mse", label: "MSE" },
  { key: "directionalHitRate", label: "Directional Hit" },
  { key: "maeGainPct", label: "MAE Gain" },
  { key: "directionalGainPct", label: "Directional Gain" },
];

function formatMetric(metric: MetricKey, value: number): string {
  if (metric === "directionalHitRate" || metric === "maeGainPct" || metric === "directionalGainPct") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(4);
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

export default function BenchmarkCurve({
  points,
  selectedCheckpoint,
  onSelectCheckpoint,
}: {
  points: PredictiveBenchmarkPoint[];
  selectedCheckpoint?: number | null;
  onSelectCheckpoint?: (checkpointSize: number) => void;
}) {
  const [metric, setMetric] = useState<MetricKey>("mae");
  const ordered = useMemo(
    () => [...points].sort((a, b) => a.checkpointSize - b.checkpointSize),
    [points]
  );

  if (ordered.length === 0) {
    return (
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Benchmark Curve</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">No benchmark points yet.</p>
      </section>
    );
  }

  const width = 860;
  const height = 260;
  const left = 42;
  const right = 18;
  const top = 20;
  const bottom = 44;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  const xMin = ordered[0].checkpointSize;
  const xMax = ordered[ordered.length - 1].checkpointSize;
  const xRange = Math.max(1, xMax - xMin);

  const modelValues = ordered.map((point) => point[metric]);
  const baselineValues = ordered.map((point) => {
    if (metric === "mae") return point.baselineMae;
    if (metric === "mse") return point.baselineMse;
    if (metric === "directionalHitRate") return point.baselineDirectionalHitRate;
    return 0;
  });
  const includeBaseline = metric === "mae" || metric === "mse" || metric === "directionalHitRate";

  const yValues = includeBaseline ? [...modelValues, ...baselineValues] : [...modelValues, 0];
  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);
  if (Math.abs(yMax - yMin) < 1e-9) {
    yMin -= 0.1;
    yMax += 0.1;
  }
  const yPadding = (yMax - yMin) * 0.08;
  yMin -= yPadding;
  yMax += yPadding;

  const toX = (checkpointSize: number) =>
    left + ((checkpointSize - xMin) / xRange) * chartWidth;
  const toY = (value: number) =>
    top + (1 - (value - yMin) / (yMax - yMin)) * chartHeight;

  const modelPlot = ordered.map((point) => ({
    checkpointSize: point.checkpointSize,
    x: toX(point.checkpointSize),
    y: toY(point[metric]),
    raw: point[metric],
  }));

  const baselinePlot = ordered.map((point) => ({
    x: toX(point.checkpointSize),
    y: toY(
      metric === "mae"
        ? point.baselineMae
        : metric === "mse"
          ? point.baselineMse
          : metric === "directionalHitRate"
            ? point.baselineDirectionalHitRate
            : 0
    ),
  }));

  const selectedSize = selectedCheckpoint ?? ordered[ordered.length - 1]?.checkpointSize;
  const selectedPoint = ordered.find((point) => point.checkpointSize === selectedSize) ?? ordered[ordered.length - 1];

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Benchmark Curve</p>
        <div className="flex flex-wrap items-center gap-2">
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMetric(option.key)}
              className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors ${
                option.key === metric
                  ? "border-[var(--amber)] bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                  : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-medium)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[240px] min-w-[700px] w-full rounded-2xl bg-[var(--bg-elevated)]"
        >
          <line
            x1={left}
            y1={height - bottom}
            x2={width - right}
            y2={height - bottom}
            stroke="var(--border-medium)"
            strokeWidth={1}
          />
          <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="var(--border-medium)" strokeWidth={1} />

          {!includeBaseline && (
            <line
              x1={left}
              y1={toY(0)}
              x2={width - right}
              y2={toY(0)}
              stroke="var(--border-medium)"
              strokeWidth={1}
              strokeDasharray="4 6"
              opacity={0.7}
            />
          )}

          {includeBaseline && (
            <path
              d={buildPath(baselinePlot)}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1.6}
              strokeDasharray="5 5"
              opacity={0.8}
            />
          )}

          <path
            d={buildPath(modelPlot)}
            fill="none"
            stroke="var(--amber)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />

          {modelPlot.map((point) => {
            const active = point.checkpointSize === selectedPoint.checkpointSize;
            return (
              <circle
                key={point.checkpointSize}
                cx={point.x}
                cy={point.y}
                r={active ? 5.5 : 4}
                fill={active ? "var(--amber)" : "var(--bg-card)"}
                stroke="var(--amber)"
                strokeWidth={active ? 2 : 1.5}
                className="cursor-pointer transition-all"
                onClick={() => onSelectCheckpoint?.(point.checkpointSize)}
              />
            );
          })}

          {ordered.map((point) => (
            <text
              key={`x-${point.checkpointSize}`}
              x={toX(point.checkpointSize)}
              y={height - bottom + 18}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="10"
            >
              {point.checkpointSize}
            </text>
          ))}

          <text x={left} y={12} fill="var(--text-muted)" fontSize="10">
            {formatMetric(metric, yMax)}
          </text>
          <text x={left} y={height - bottom - 4} fill="var(--text-muted)" fontSize="10">
            {formatMetric(metric, yMin)}
          </text>
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--amber)]" />
          model
        </span>
        {(metric === "mae" || metric === "mse" || metric === "directionalHitRate") && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-[var(--text-muted)]" />
            baseline
          </span>
        )}
        <span>selected checkpoint {selectedPoint.checkpointSize}</span>
      </div>
    </section>
  );
}
