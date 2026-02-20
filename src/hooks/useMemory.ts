"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

// ── Contact-specific memory hooks ────────────────────────────────────

export interface ContactMemory {
  id: string;
  content: string;
  sourceDate: string;
  source: string;
  strength: number;
  contactIds: string[];
}

export function useContactMemories(contactId: string | null) {
  return useQuery<ContactMemory[]>({
    queryKey: ["contact", contactId, "memories"],
    queryFn: async () => {
      const res = await fetch(`/api/memories?contactId=${contactId}`);
      if (!res.ok) throw new Error("Failed to fetch memories");
      const data = await res.json();
      return data.memories;
    },
    enabled: !!contactId,
    staleTime: 30 * 1000,
  });
}

export function useUpdateMemoryContacts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      memoryId,
      contactIds,
    }: {
      memoryId: string;
      contactIds: string[] | null;
    }) => {
      const res = await fetch(`/api/memories/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds }),
      });
      if (!res.ok) throw new Error("Failed to update memory");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate memories for ALL contacts (the memory moved between contacts)
      queryClient.invalidateQueries({ queryKey: ["contact"] });
      queryClient.invalidateQueries({ queryKey: ["memory-graph"] });
      queryClient.invalidateQueries({ queryKey: ["memory-stats"] });
    },
  });
}
