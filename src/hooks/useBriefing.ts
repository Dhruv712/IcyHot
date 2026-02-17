"use client";

import { useQuery } from "@tanstack/react-query";
import type { DailyBriefingContent } from "@/lib/briefing";

interface BriefingResponse {
  briefing: DailyBriefingContent | null;
  date: string;
  cached: boolean;
}

export function useDailyBriefing() {
  return useQuery<BriefingResponse>({
    queryKey: ["daily-briefing"],
    queryFn: async () => {
      const res = await fetch("/api/briefing");
      if (!res.ok) throw new Error("Failed to fetch briefing");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min — briefing is daily, no need to refetch often
  });
}
