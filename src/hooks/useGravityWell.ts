"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

export interface ClusterNode {
  label: string;
  memberCount: number;
  x: number;
  y: number;
}

export interface MemoryDot {
  x: number;
  y: number;
  source: string;
  strength: number;
}

interface ProjectionResult {
  x: number;
  y: number;
  similarities: number[];
}

const DEBOUNCE_MS = 2_000;
const MIN_PARAGRAPH_LENGTH = 10;
const MAX_TRAIL_POINTS = 50;

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function useGravityWell({
  entryDate,
  enabled,
}: {
  entryDate: string;
  enabled: boolean;
}) {
  const [currentPosition, setCurrentPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [trail, setTrail] = useState<Array<{ x: number; y: number }>>([]);

  const queriedHashesRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch cluster layout
  const { data: clusterData, isLoading } = useQuery({
    queryKey: ["memory-clusters"],
    queryFn: async () => {
      const res = await fetch("/api/memory/clusters");
      if (!res.ok) throw new Error("Failed to load clusters");
      return res.json() as Promise<{
        clusters: ClusterNode[];
        memoryDots: MemoryDot[];
      }>;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  // Clear trail on entry switch
  useEffect(() => {
    setCurrentPosition(null);
    setTrail([]);
    queriedHashesRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, [entryDate]);

  const triggerProjection = useCallback(
    async (paragraphText: string) => {
      const hash = simpleHash(paragraphText.trim());
      if (queriedHashesRef.current.has(hash)) return;
      queriedHashesRef.current.add(hash);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/journal/gravity-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paragraph: paragraphText }),
          signal: controller.signal,
        });

        if (!res.ok) return;
        const data: ProjectionResult = await res.json();

        setCurrentPosition({ x: data.x, y: data.y });
        setTrail((prev) => {
          const next = [...prev, { x: data.x, y: data.y }];
          return next.length > MAX_TRAIL_POINTS ? next.slice(-MAX_TRAIL_POINTS) : next;
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("[gravity-well] Projection failed:", e);
      }
    },
    [],
  );

  const handleParagraphChange = useCallback(
    (paragraph: { index: number; text: string }) => {
      if (!enabled) return;
      if (paragraph.text.trim().length < MIN_PARAGRAPH_LENGTH) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        triggerProjection(paragraph.text);
      }, DEBOUNCE_MS);
    },
    [enabled, triggerProjection],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    clusters: clusterData?.clusters ?? [],
    memoryDots: clusterData?.memoryDots ?? [],
    currentPosition,
    trail,
    isLoading,
    handleParagraphChange,
  };
}
