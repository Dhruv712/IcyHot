"use client";

import { useQuery } from "@tanstack/react-query";
import type { RetrievalResult } from "@/lib/memory/retrieve";

interface MemoryStatsResponse {
  success: boolean;
  memories: {
    total: number;
    avgStrength: number;
    avgActivationCount: number;
  };
  connections: {
    total: number;
    avgWeight: number;
    byType: Array<{ type: string; count: number }>;
  };
  implications: {
    total: number;
    avgStrength: number;
    byType: Array<{ type: string; order: number; count: number }>;
  };
  recentlyActive: number;
  topConnectedMemories: Array<{
    id: string;
    content: string;
    strength: number;
    sourceDate: string;
    connectionCount: number;
  }>;
}

export function useMemorySearch(query: string) {
  return useQuery<RetrievalResult>({
    queryKey: ["memory-search", query],
    queryFn: async () => {
      const res = await fetch("/api/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, skipHebbian: true }),
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: query.length > 2,
    staleTime: 30 * 1000,
  });
}

export function useMemoryStats() {
  return useQuery<MemoryStatsResponse>({
    queryKey: ["memory-stats"],
    queryFn: async () => {
      const res = await fetch("/api/memory/stats");
      if (!res.ok) throw new Error("Failed to fetch memory stats");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

interface MemoryGraphResponse {
  nodes: Array<{
    id: string;
    content: string;
    fullContent: string;
    sourceDate: string;
    strength: number;
    activationCount: number;
    source: string;
    contactIds: string[];
    connectionCount: number;
    ux: number;
    uy: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    connectionType: string | null;
    reason: string | null;
  }>;
  implications: Array<{
    id: string;
    content: string;
    sourceMemoryIds: string[];
    implicationType: string | null;
  }>;
}

export function useMemoryGraph() {
  return useQuery<MemoryGraphResponse>({
    queryKey: ["memory-graph"],
    queryFn: async () => {
      const res = await fetch("/api/memory/graph");
      if (!res.ok) throw new Error("Failed to fetch memory graph");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
