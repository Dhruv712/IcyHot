"use client";

import { useQuery } from "@tanstack/react-query";
import type { WeeklyRetroContent } from "@/lib/retro";

interface RetroResponse {
  retro: WeeklyRetroContent | null;
  weekStart: string;
  cached: boolean;
}

export function useWeeklyRetro() {
  return useQuery<RetroResponse>({
    queryKey: ["weekly-retro"],
    queryFn: async () => {
      const res = await fetch("/api/retro");
      if (!res.ok) throw new Error("Failed to fetch retro");
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // 10 min
  });
}
