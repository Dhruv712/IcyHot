"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  coerceMarginTuning,
  DEFAULT_MARGIN_TUNING,
  type MarginTuningSettings,
} from "@/lib/marginTuning";

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
  trace?: MarginTrace;
}

export interface MarginTrace {
  reason: string;
  retrieval?: {
    totalMemories: number;
    strongMemories: number;
    topScore: number;
    secondScore: number;
    hasClearSignal: boolean;
    implications: number;
    topSamples: Array<{
      score: number;
      hop: number;
      snippet: string;
    }>;
  };
  llm?: {
    rawCandidates: number;
    accepted: number;
    failureMode:
      | "accepted"
      | "model_empty"
      | "no_json"
      | "json_parse_error"
      | "filtered_text"
      | "filtered_type"
      | "filtered_confidence";
    minModelConfidence: number;
  };
  timingsMs: {
    retrieve: number;
    llm: number;
    total: number;
  };
}

export interface MarginInspectorState {
  phase: "idle" | "debouncing" | "querying" | "done" | "error";
  message: string;
  paragraphIndex?: number;
  paragraphPreview?: string;
  trace?: MarginTrace;
  updatedAt: number;
}

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function annotationSignature(annotation: MarginAnnotation): string {
  return [
    annotation.type,
    annotation.text.trim().toLowerCase(),
    annotation.memoryDate ?? "",
    annotation.memorySnippet?.trim().toLowerCase() ?? "",
  ].join("|");
}

export function useMarginIntelligence({
  entryDate,
  enabled,
  tuning,
}: {
  entryDate: string;
  enabled: boolean;
  tuning?: MarginTuningSettings;
}) {
  const resolvedTuning = useMemo(
    () => coerceMarginTuning(tuning ?? DEFAULT_MARGIN_TUNING),
    [tuning],
  );
  const tuningKey = useMemo(() => JSON.stringify(resolvedTuning), [resolvedTuning]);

  const [annotations, setAnnotations] = useState<MarginAnnotation[]>([]);
  const [inspector, setInspector] = useState<MarginInspectorState>({
    phase: "idle",
    message: "Idle",
    updatedAt: 0,
  });
  const dismissedRef = useRef(new Set<string>());
  const shownRef = useRef(new Set<string>());
  const queriedHashesRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryAtRef = useRef(0);
  const lastAnnotatedAtRef = useRef(0);
  const annotationCountRef = useRef(0);
  const lastAnnotatedParagraphRef = useRef(-Infinity);

  // Clear all state on entry switch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when switching journal entries
    setAnnotations([]);
    setInspector({
      phase: "idle",
      message: "Idle",
      updatedAt: Date.now(),
    });
    dismissedRef.current.clear();
    shownRef.current.clear();
    queriedHashesRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    lastQueryAtRef.current = 0;
    lastAnnotatedAtRef.current = 0;
    annotationCountRef.current = 0;
    lastAnnotatedParagraphRef.current = -Infinity;
  }, [entryDate]);

  // Allow re-querying the same paragraph after tuning changes.
  useEffect(() => {
    queriedHashesRef.current.clear();
    lastQueryAtRef.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional refresh after tuning changes
    setInspector({
      phase: "idle",
      message: "Settings updated. Ready for next paragraph.",
      updatedAt: Date.now(),
    });
  }, [tuningKey]);

  const triggerQuery = useCallback(
    async (
      paragraphText: string,
      fullEntry: string,
      paragraphIndex: number,
    ) => {
      if (
        annotationCountRef.current >=
        resolvedTuning.client.maxAnnotationsPerEntry
      ) {
        setInspector({
          phase: "done",
          message: `Skipped: entry annotation cap (${resolvedTuning.client.maxAnnotationsPerEntry}) reached.`,
          paragraphIndex,
          paragraphPreview: paragraphText.slice(0, 120),
          updatedAt: Date.now(),
        });
        return;
      }
      if (
        Math.abs(paragraphIndex - lastAnnotatedParagraphRef.current) <=
        resolvedTuning.client.minParagraphGap
      ) {
        setInspector({
          phase: "done",
          message: `Skipped: too close to last annotated paragraph (gap <= ${resolvedTuning.client.minParagraphGap}).`,
          paragraphIndex,
          paragraphPreview: paragraphText.slice(0, 120),
          updatedAt: Date.now(),
        });
        return;
      }
      if (
        Date.now() - lastAnnotatedAtRef.current <
        resolvedTuning.client.annotationCooldownMs
      ) {
        setInspector({
          phase: "done",
          message: `Skipped: cooldown active (${resolvedTuning.client.annotationCooldownMs}ms).`,
          paragraphIndex,
          paragraphPreview: paragraphText.slice(0, 120),
          updatedAt: Date.now(),
        });
        return;
      }
      if (
        Date.now() - lastQueryAtRef.current <
        resolvedTuning.client.minQueryGapMs
      ) {
        setInspector({
          phase: "done",
          message: `Skipped: query gap active (${resolvedTuning.client.minQueryGapMs}ms).`,
          paragraphIndex,
          paragraphPreview: paragraphText.slice(0, 120),
          updatedAt: Date.now(),
        });
        return;
      }

      const hash = simpleHash(paragraphText.trim());
      if (queriedHashesRef.current.has(hash)) return;
      queriedHashesRef.current.add(hash);
      lastQueryAtRef.current = Date.now();
      setInspector({
        phase: "querying",
        message: "Scanning memories and patterns...",
        paragraphIndex,
        paragraphPreview: paragraphText.slice(0, 120),
        updatedAt: Date.now(),
      });

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
            tuning: resolvedTuning,
          }),
          signal: controller.signal,
        });

        if (!res.ok) return;
        const data: MarginResponse = await res.json();

        setAnnotations((prev) => {
          // Remove existing annotations for this paragraph
          const filtered = prev.filter((a) => a.paragraphIndex !== paragraphIndex);

          // Add new ones, filtered by dismissal and already-shown signatures.
          const newOnes = data.annotations.filter((a) => {
            const sig = annotationSignature(a);
            if (dismissedRef.current.has(sig)) return false;
            if (shownRef.current.has(sig)) return false;
            return true;
          });

          if (newOnes.length > 0) {
            for (const annotation of newOnes) {
              shownRef.current.add(annotationSignature(annotation));
            }
            annotationCountRef.current += newOnes.length;
            lastAnnotatedAtRef.current = Date.now();
            lastAnnotatedParagraphRef.current = paragraphIndex;
          }

          return [...filtered, ...newOnes];
        });

        setInspector({
          phase: "done",
          message:
            data.annotations.length > 0
              ? "Found a margin nudge."
              : data.trace?.reason || "No strong margin nudge this round.",
          paragraphIndex,
          paragraphPreview: paragraphText.slice(0, 120),
          trace: data.trace,
          updatedAt: Date.now(),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("[margin] Query failed:", e);
        setInspector({
          phase: "error",
          message: e instanceof Error ? e.message : "Margin query failed",
          paragraphIndex,
          paragraphPreview: paragraphText.slice(0, 120),
          updatedAt: Date.now(),
        });
      }
    },
    [entryDate, resolvedTuning],
  );

  const handleParagraphChange = useCallback(
    (paragraph: { index: number; text: string }, fullMarkdown: string) => {
      if (!enabled) return;
      const text = paragraph.text.trim();
      if (text.length < resolvedTuning.client.minParagraphLength) {
        setInspector({
          phase: "done",
          message: `Waiting for a longer paragraph (${text.length}/${resolvedTuning.client.minParagraphLength} chars).`,
          paragraphIndex: paragraph.index,
          paragraphPreview: text.slice(0, 120),
          updatedAt: Date.now(),
        });
        return;
      }
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < resolvedTuning.client.minParagraphWords) {
        setInspector({
          phase: "done",
          message: `Waiting for more words (${wordCount}/${resolvedTuning.client.minParagraphWords}).`,
          paragraphIndex: paragraph.index,
          paragraphPreview: text.slice(0, 120),
          updatedAt: Date.now(),
        });
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      setInspector({
        phase: "debouncing",
        message: `Paused. Querying in ${Math.round(
          resolvedTuning.client.debounceMs / 1000,
        )}s...`,
        paragraphIndex: paragraph.index,
        paragraphPreview: text.slice(0, 120),
        updatedAt: Date.now(),
      });
      debounceRef.current = setTimeout(() => {
        triggerQuery(text, fullMarkdown, paragraph.index);
      }, resolvedTuning.client.debounceMs);
    },
    [enabled, triggerQuery, resolvedTuning.client],
  );

  const dismissAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        dismissedRef.current.add(annotationSignature(target));
      }
      return prev.filter((a) => a.id !== id);
    });
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
    inspector,
  };
}
