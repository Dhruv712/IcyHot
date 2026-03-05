"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { PredictiveBenchmarkProgressEvent } from "./predictiveTypes";

type RunMode = "quick" | "full";

type CheckpointProgress = {
  checkpointSize: number;
  checkpointIndex: number;
  checkpointTotal: number;
  sampleCount?: number;
  metrics?: {
    mae: number;
    mse: number;
    directionalHitRate: number;
    baselineMae: number;
    baselineMse: number;
    baselineDirectionalHitRate: number;
    maeGainPct: number;
    directionalGainPct: number;
  };
};

export type PredictiveRunProgressState = {
  status: "idle" | "running" | "complete" | "error";
  mode: RunMode | null;
  runId: string | null;
  frameCount: number;
  checkpointSchedule: number[];
  sampleLimit: number;
  currentCheckpoint: CheckpointProgress | null;
  completedCheckpoints: CheckpointProgress[];
  summary: Record<string, unknown> | null;
  error: string | null;
  startedAtMs: number | null;
  elapsedMs: number;
};

const INITIAL_STATE: PredictiveRunProgressState = {
  status: "idle",
  mode: null,
  runId: null,
  frameCount: 0,
  checkpointSchedule: [],
  sampleLimit: 0,
  currentCheckpoint: null,
  completedCheckpoints: [],
  summary: null,
  error: null,
  startedAtMs: null,
  elapsedMs: 0,
};

async function readApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return text.slice(0, 240) || fallback;
  }
}

export function useRunPredictiveBenchmark() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PredictiveRunProgressState>(INITIAL_STATE);

  const mutation = useMutation<void, Error, { mode: RunMode }>({
    mutationFn: async ({ mode }) => {
      setProgress({
        ...INITIAL_STATE,
        status: "running",
        mode,
        startedAtMs: Date.now(),
      });

      const res = await fetch("/api/predictive/benchmark/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      });

      if (!res.ok || !res.body) {
        const errorMessage = await readApiError(res, "Failed to start benchmark run");
        setProgress((prev) => ({
          ...prev,
          status: "error",
          error: errorMessage,
          elapsedMs: prev.startedAtMs ? Date.now() - prev.startedAtMs : 0,
        }));
        throw new Error(errorMessage);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const applyEvent = (event: PredictiveBenchmarkProgressEvent) => {
        setProgress((prev) => {
          switch (event.type) {
            case "run_started":
              return {
                ...prev,
                status: "running",
                mode: event.mode,
                runId: event.runId,
                frameCount: event.frameCount,
                checkpointSchedule: event.checkpointSchedule,
                sampleLimit: event.sampleLimit,
                error: null,
                elapsedMs: prev.startedAtMs ? Date.now() - prev.startedAtMs : 0,
              };
            case "checkpoint_started":
              return {
                ...prev,
                currentCheckpoint: {
                  checkpointSize: event.checkpointSize,
                  checkpointIndex: event.checkpointIndex,
                  checkpointTotal: event.checkpointTotal,
                },
                elapsedMs: prev.startedAtMs ? Date.now() - prev.startedAtMs : prev.elapsedMs,
              };
            case "checkpoint_complete": {
              const checkpoint: CheckpointProgress = {
                checkpointSize: event.checkpointSize,
                checkpointIndex: event.checkpointIndex,
                checkpointTotal: event.checkpointTotal,
                sampleCount: event.sampleCount,
                metrics: event.metrics,
              };
              const deduped = prev.completedCheckpoints.filter(
                (item) => item.checkpointSize !== checkpoint.checkpointSize
              );

              return {
                ...prev,
                currentCheckpoint: checkpoint,
                completedCheckpoints: [...deduped, checkpoint].sort(
                  (a, b) => a.checkpointSize - b.checkpointSize
                ),
                elapsedMs: prev.startedAtMs ? Date.now() - prev.startedAtMs : prev.elapsedMs,
              };
            }
            case "complete":
              return {
                ...prev,
                status: "complete",
                runId: event.runId,
                summary: event.summary,
                elapsedMs: event.durationMs,
                error: null,
              };
            case "error":
              return {
                ...prev,
                status: "error",
                runId: event.runId ?? prev.runId,
                error: event.message,
                elapsedMs: prev.startedAtMs ? Date.now() - prev.startedAtMs : prev.elapsedMs,
              };
            default:
              return prev;
          }
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          applyEvent(JSON.parse(trimmed) as PredictiveBenchmarkProgressEvent);
        }
      }

      if (buffer.trim()) {
        applyEvent(JSON.parse(buffer.trim()) as PredictiveBenchmarkProgressEvent);
      }

      queryClient.invalidateQueries({ queryKey: ["predictive-overview"] });
      queryClient.invalidateQueries({ queryKey: ["predictive-benchmark-runs"] });
      queryClient.invalidateQueries({ queryKey: ["predictive-benchmark-run"] });
    },
  });

  const reset = () => setProgress(INITIAL_STATE);

  return useMemo(
    () => ({
      ...mutation,
      progress,
      reset,
    }),
    [mutation, progress]
  );
}
