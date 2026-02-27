"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  coerceMarginTuning,
  DEFAULT_MARGIN_TUNING,
  type MarginTuningSettings,
} from "@/lib/marginTuning";
import {
  type MarginDownReason,
  type MarginTrace,
  type SparkNudge,
  type SparkNudgeType,
} from "@/lib/marginSpark";

export interface MarginAnnotation {
  id: string;
  type: "ghost_question" | "tension";
  text: string;
  paragraphIndex: number;
  memoryDate?: string;
  memorySnippet?: string;
}

export interface SparkNudgeCard extends SparkNudge {
  createdAtMs: number;
  collapsed: boolean;
  feedback?: {
    value: "up" | "down";
    reason?: MarginDownReason;
  };
  feedbackPending?: boolean;
}

interface MarginResponse {
  nudges?: SparkNudge[];
  annotations: MarginAnnotation[];
  paragraphHash: string;
  trace?: MarginTrace;
}

export interface MarginInspectorState {
  phase: "idle" | "debouncing" | "querying" | "done" | "error";
  message: string;
  paragraphIndex?: number;
  paragraphPreview?: string;
  trace?: MarginTrace;
  updatedAt: number;
}

export interface SparkSummary {
  totalVisible: number;
  byType: Record<SparkNudgeType, number>;
  feedback: {
    up: number;
    down: number;
  };
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

function nudgeSignature(nudge: SparkNudge): string {
  return [
    nudge.type,
    nudge.hook.trim().toLowerCase(),
    nudge.evidenceMemoryDate ?? "",
    nudge.evidenceMemorySnippet?.trim().toLowerCase() ?? "",
  ].join("|");
}

function collapseStack(cards: SparkNudgeCard[]): SparkNudgeCard[] {
  if (cards.length === 0) return cards;
  const sorted = [...cards].sort((a, b) => a.createdAtMs - b.createdAtMs);
  return sorted.map((card, idx) => ({
    ...card,
    collapsed: idx < sorted.length - 1,
  }));
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
  const sessionIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `session-${Date.now()}`,
  );

  const [annotations, setAnnotations] = useState<MarginAnnotation[]>([]);
  const [nudges, setNudges] = useState<SparkNudgeCard[]>([]);
  const [inspector, setInspector] = useState<MarginInspectorState>({
    phase: "idle",
    message: "Idle",
    updatedAt: 0,
  });

  const dismissedAnnotationsRef = useRef(new Set<string>());
  const shownAnnotationsRef = useRef(new Set<string>());
  const dismissedNudgesRef = useRef(new Set<string>());
  const shownNudgesRef = useRef(new Set<string>());
  const queriedHashesRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryAtRef = useRef(0);
  const lastAnnotatedAtRef = useRef(0);
  const annotationCountRef = useRef(0);
  const lastAnnotatedParagraphRef = useRef(-Infinity);

  const sparkSummary = useMemo<SparkSummary>(() => {
    const byType: Record<SparkNudgeType, number> = {
      tension: 0,
      callback: 0,
      eyebrow_raise: 0,
    };

    let up = 0;
    let down = 0;

    for (const nudge of nudges) {
      byType[nudge.type] += 1;
      if (nudge.feedback?.value === "up") up += 1;
      if (nudge.feedback?.value === "down") down += 1;
    }

    return {
      totalVisible: nudges.length,
      byType,
      feedback: { up, down },
    };
  }, [nudges]);

  useEffect(() => {
    setAnnotations([]);
    setNudges([]);
    setInspector({
      phase: "idle",
      message: "Idle",
      updatedAt: Date.now(),
    });
    dismissedAnnotationsRef.current.clear();
    shownAnnotationsRef.current.clear();
    dismissedNudgesRef.current.clear();
    shownNudgesRef.current.clear();
    queriedHashesRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    lastQueryAtRef.current = 0;
    lastAnnotatedAtRef.current = 0;
    annotationCountRef.current = 0;
    lastAnnotatedParagraphRef.current = -Infinity;
  }, [entryDate]);

  useEffect(() => {
    queriedHashesRef.current.clear();
    lastQueryAtRef.current = 0;
    setInspector({
      phase: "idle",
      message: "Settings updated. Ready for next paragraph.",
      updatedAt: Date.now(),
    });
  }, [tuningKey]);

  const submitNudgeFeedback = useCallback(
    async (
      nudgeId: string,
      feedback: "up" | "down",
      reason?: MarginDownReason,
    ) => {
      setNudges((prev) =>
        prev.map((nudge) =>
          nudge.id === nudgeId
            ? {
                ...nudge,
                feedback: {
                  value: feedback,
                  reason: feedback === "down" ? reason : undefined,
                },
                feedbackPending: true,
              }
            : nudge,
        ),
      );

      try {
        const res = await fetch("/api/journal/margin/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nudgeId, feedback, reason }),
        });

        if (!res.ok) throw new Error(`Feedback request failed (${res.status})`);

        setNudges((prev) =>
          prev.map((nudge) =>
            nudge.id === nudgeId ? { ...nudge, feedbackPending: false } : nudge,
          ),
        );
      } catch (error) {
        console.error("[margin] Feedback submission failed:", error);
        setNudges((prev) =>
          prev.map((nudge) =>
            nudge.id === nudgeId
              ? {
                  ...nudge,
                  feedbackPending: false,
                  feedback: undefined,
                }
              : nudge,
          ),
        );
      }
    },
    [],
  );

  const dismissNudge = useCallback((id: string) => {
    setNudges((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target) dismissedNudgesRef.current.add(nudgeSignature(target));
      return collapseStack(prev.filter((n) => n.id !== id));
    });
  }, []);

  const expandNudge = useCallback((id: string) => {
    setNudges((prev) =>
      prev.map((nudge) => ({
        ...nudge,
        collapsed: nudge.id === id ? false : nudge.collapsed,
      })),
    );
  }, []);

  const triggerQuery = useCallback(
    async (
      paragraphText: string,
      fullEntry: string,
      paragraphIndex: number,
    ) => {
      if (annotationCountRef.current >= resolvedTuning.client.maxAnnotationsPerEntry) {
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

      if (Date.now() - lastQueryAtRef.current < resolvedTuning.client.minQueryGapMs) {
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
        message: "Scanning memories, generating candidates, and judging utility...",
        paragraphIndex,
        paragraphPreview: paragraphText.slice(0, 120),
        updatedAt: Date.now(),
      });

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
            clientSessionId: sessionIdRef.current,
          }),
          signal: controller.signal,
        });

        if (!res.ok) return;
        const data: MarginResponse = await res.json();

        const incomingNudges = (data.nudges ?? []).filter((nudge) => {
          const sig = nudgeSignature(nudge);
          if (dismissedNudgesRef.current.has(sig)) return false;
          if (shownNudgesRef.current.has(sig)) return false;
          return true;
        });

        setNudges((prev) => {
          if (incomingNudges.length === 0) return prev;

          const filtered = prev.filter((n) => n.paragraphIndex !== paragraphIndex);
          const enriched = incomingNudges.map((nudge) => ({
            ...nudge,
            createdAtMs: Date.now(),
            collapsed: false,
          }));

          for (const nudge of incomingNudges) {
            shownNudgesRef.current.add(nudgeSignature(nudge));
          }

          const merged = [...filtered, ...enriched]
            .sort((a, b) => a.createdAtMs - b.createdAtMs)
            .slice(-3);

          annotationCountRef.current += incomingNudges.length;
          lastAnnotatedAtRef.current = Date.now();
          lastAnnotatedParagraphRef.current = paragraphIndex;

          return collapseStack(merged);
        });

        setAnnotations((prev) => {
          const filtered = prev.filter((a) => a.paragraphIndex !== paragraphIndex);

          const newOnes = data.annotations.filter((a) => {
            const sig = annotationSignature(a);
            if (dismissedAnnotationsRef.current.has(sig)) return false;
            if (shownAnnotationsRef.current.has(sig)) return false;
            return true;
          });

          if (newOnes.length > 0) {
            for (const annotation of newOnes) {
              shownAnnotationsRef.current.add(annotationSignature(annotation));
            }
            if (incomingNudges.length === 0) {
              annotationCountRef.current += newOnes.length;
              lastAnnotatedAtRef.current = Date.now();
              lastAnnotatedParagraphRef.current = paragraphIndex;
            }
          }

          return [...filtered, ...newOnes];
        });

        setInspector({
          phase: "done",
          message:
            incomingNudges.length > 0
              ? "Spark card ready."
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
      if (target) dismissedAnnotationsRef.current.add(annotationSignature(target));
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    annotations,
    nudges,
    handleParagraphChange,
    dismissAnnotation,
    dismissNudge,
    expandNudge,
    submitNudgeFeedback,
    inspector,
    sparkSummary,
  };
}
