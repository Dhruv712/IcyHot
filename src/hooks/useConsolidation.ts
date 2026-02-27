"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConsolidationDigestRecord } from "@/lib/memory/consolidationDigest";

interface ConsolidationDigestResponse {
  digest: ConsolidationDigestRecord | null;
  requestedDate: string;
  timeZone: string;
}

export function useLatestConsolidationDigest() {
  return useQuery<ConsolidationDigestResponse>({
    queryKey: ["consolidation-latest"],
    queryFn: async () => {
      const res = await fetch("/api/consolidation/latest", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch consolidation digest");
      }
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}
