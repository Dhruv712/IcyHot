"use client";

import { useQuery } from "@tanstack/react-query";
import type { PredictiveBenchmarkRun } from "./predictiveTypes";

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

export function usePredictiveBenchmarkRuns(limit = 20, offset = 0) {
  return useQuery<{ runs: PredictiveBenchmarkRun[] }>({
    queryKey: ["predictive-benchmark-runs", limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      const res = await fetch(`/api/predictive/benchmark/runs?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to fetch benchmark runs"));
      }
      return res.json();
    },
    staleTime: 15 * 1000,
  });
}

export function usePredictiveBenchmarkRun(runId?: string) {
  return useQuery<PredictiveBenchmarkRun>({
    queryKey: ["predictive-benchmark-run", runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await fetch(`/api/predictive/benchmark/runs/${runId}`);
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to fetch benchmark run"));
      }
      const payload = (await res.json()) as { run: PredictiveBenchmarkRun };
      return payload.run;
    },
    staleTime: 5 * 1000,
  });
}
