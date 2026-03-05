"use client";

import { useQuery } from "@tanstack/react-query";
import type { PredictiveOverview } from "./predictiveTypes";

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

export function usePredictiveOverview() {
  return useQuery<PredictiveOverview>({
    queryKey: ["predictive-overview"],
    queryFn: async () => {
      const res = await fetch("/api/predictive/overview");
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to fetch predictive overview"));
      }
      const payload = (await res.json()) as { overview: PredictiveOverview };
      return payload.overview;
    },
    staleTime: 15 * 1000,
  });
}
