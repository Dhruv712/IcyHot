"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export interface MarginAnnotation {
  id: string;
  type: "ghost_question" | "tension";
  text: string;
  paragraphIndex: number;
  memoryDate?: string;
  memorySnippet?: string;
}

interface MarginResponse {
  annotations: MarginAnnotation[];
  paragraphHash: string;
}

const DEBOUNCE_MS = 4_000;
const MIN_PARAGRAPH_LENGTH = 20;

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function useMarginIntelligence({
  entryDate,
  enabled,
}: {
  entryDate: string;
  enabled: boolean;
}) {
  const [annotations, setAnnotations] = useState<MarginAnnotation[]>([]);
  const dismissedRef = useRef(new Set<string>());
  const queriedHashesRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear all state on entry switch
  useEffect(() => {
    setAnnotations([]);
    dismissedRef.current.clear();
    queriedHashesRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, [entryDate]);

  const triggerQuery = useCallback(
    async (
      paragraphText: string,
      fullEntry: string,
      paragraphIndex: number,
    ) => {
      const hash = simpleHash(paragraphText.trim());
      if (queriedHashesRef.current.has(hash)) return;
      queriedHashesRef.current.add(hash);

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/journal/margin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paragraph: paragraphText,
            fullEntry,
            entryDate,
            paragraphIndex,
          }),
          signal: controller.signal,
        });

        if (!res.ok) return;
        const data: MarginResponse = await res.json();

        if (data.annotations.length > 0) {
          setAnnotations((prev) => {
            // Remove existing annotations for this paragraph
            const filtered = prev.filter(
              (a) => a.paragraphIndex !== paragraphIndex,
            );
            // Add new ones, filter dismissed
            const newOnes = data.annotations.filter(
              (a) => !dismissedRef.current.has(a.id),
            );
            return [...filtered, ...newOnes];
          });
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("[margin] Query failed:", e);
      }
    },
    [entryDate],
  );

  const handleParagraphChange = useCallback(
    (paragraph: { index: number; text: string }, fullMarkdown: string) => {
      if (!enabled) return;
      if (paragraph.text.trim().length < MIN_PARAGRAPH_LENGTH) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        triggerQuery(paragraph.text, fullMarkdown, paragraph.index);
      }, DEBOUNCE_MS);
    },
    [enabled, triggerQuery],
  );

  const dismissAnnotation = useCallback((id: string) => {
    dismissedRef.current.add(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    annotations,
    handleParagraphChange,
    dismissAnnotation,
  };
}
