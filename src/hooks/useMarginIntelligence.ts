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

const DEBOUNCE_MS = 3_500;
const MIN_PARAGRAPH_LENGTH = 30;
const MIN_PARAGRAPH_WORDS = 8;
const MIN_QUERY_GAP_MS = 7_000;
const ANNOTATION_COOLDOWN_MS = 20_000;
const MAX_ANNOTATIONS_PER_ENTRY = 8;
const MIN_PARAGRAPH_GAP = 0;

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
}: {
  entryDate: string;
  enabled: boolean;
}) {
  const [annotations, setAnnotations] = useState<MarginAnnotation[]>([]);
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

  const triggerQuery = useCallback(
    async (
      paragraphText: string,
      fullEntry: string,
      paragraphIndex: number,
    ) => {
      if (annotationCountRef.current >= MAX_ANNOTATIONS_PER_ENTRY) return;
      if (Math.abs(paragraphIndex - lastAnnotatedParagraphRef.current) <= MIN_PARAGRAPH_GAP) return;
      if (Date.now() - lastAnnotatedAtRef.current < ANNOTATION_COOLDOWN_MS) return;
      if (Date.now() - lastQueryAtRef.current < MIN_QUERY_GAP_MS) return;

      const hash = simpleHash(paragraphText.trim());
      if (queriedHashesRef.current.has(hash)) return;
      queriedHashesRef.current.add(hash);
      lastQueryAtRef.current = Date.now();

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
      const text = paragraph.text.trim();
      if (text.length < MIN_PARAGRAPH_LENGTH) return;
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < MIN_PARAGRAPH_WORDS) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        triggerQuery(text, fullMarkdown, paragraph.index);
      }, DEBOUNCE_MS);
    },
    [enabled, triggerQuery],
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
  };
}
