"use client";

import { useQuery } from "@tanstack/react-query";
import type { GraphData } from "@/components/graph/types";

export function useGraphData() {
  return useQuery<GraphData>({
    queryKey: ["graph"],
    queryFn: async () => {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error("Failed to fetch graph data");
      return res.json();
    },
    refetchInterval: 60 * 1000,
  });
}
