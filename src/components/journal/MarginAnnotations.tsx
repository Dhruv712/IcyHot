"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { MarginAnnotation } from "@/hooks/useMarginIntelligence";

const ANNOTATION_GAP = 8; // px between stacked annotations

interface MarginAnnotationsProps {
  annotations: MarginAnnotation[];
  editorElement: HTMLElement | null;
  onDismiss: (id: string) => void;
}

export default function MarginAnnotations({
  annotations,
  editorElement,
  onDismiss,
}: MarginAnnotationsProps) {
  // Map annotation id → resolved top position (after collision avoidance)
  const [resolvedPositions, setResolvedPositions] = useState<Map<string, number>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const recalcRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const recalcPositions = useCallback(() => {
    if (!editorElement) return;
    const proseMirror = editorElement.querySelector(".ProseMirror");
    if (!proseMirror) return;

    const children = proseMirror.children;

    // 1. Get natural (paragraph-aligned) top for each annotation, sorted by position
    const sorted = annotations
      .map((a) => {
        const el = children[a.paragraphIndex] as HTMLElement | undefined;
        return { annotation: a, naturalTop: el ? el.offsetTop : -1 };
      })
      .filter((item) => item.naturalTop >= 0)
      .sort((a, b) => a.naturalTop - b.naturalTop);

    // 2. Walk top-down and push each card below the previous if they'd overlap
    const newPositions = new Map<string, number>();
    let prevBottom = -Infinity;

    for (const { annotation, naturalTop } of sorted) {
      const cardEl = cardRefs.current.get(annotation.id);
      const cardHeight = cardEl ? cardEl.offsetHeight : 60; // fallback estimate

      const resolvedTop = Math.max(naturalTop, prevBottom + ANNOTATION_GAP);
      newPositions.set(annotation.id, resolvedTop);
      prevBottom = resolvedTop + cardHeight;
    }

    setResolvedPositions(newPositions);
  }, [editorElement, annotations]);

  // Recalculate positions when annotations or editor content changes
  useEffect(() => {
    // Run twice: once immediately (with estimated heights), then after a frame
    // so card refs have measured heights for accurate collision avoidance
    recalcPositions();
    const raf = requestAnimationFrame(recalcPositions);

    // Also watch for content changes via ResizeObserver
    if (!editorElement) return;
    const proseMirror = editorElement.querySelector(".ProseMirror");
    if (!proseMirror) return;

    const observer = new ResizeObserver(() => {
      if (recalcRef.current) clearTimeout(recalcRef.current);
      recalcRef.current = setTimeout(recalcPositions, 100);
    });
    observer.observe(proseMirror);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (recalcRef.current) clearTimeout(recalcRef.current);
    };
  }, [editorElement, recalcPositions]);

  if (annotations.length === 0) return null;

  return (
    <>
      {annotations.map((annotation) => {
        const top = resolvedPositions.get(annotation.id);
        if (top === undefined) return null;

        const isHovered = hoveredId === annotation.id;

        return (
          <div
            key={annotation.id}
            ref={(el) => {
              if (el) cardRefs.current.set(annotation.id, el);
              else cardRefs.current.delete(annotation.id);
            }}
            className={`margin-annotation ${annotation.type === "tension" ? "margin-annotation--tension" : ""}`}
            style={{ top }}
            onMouseEnter={() => setHoveredId(annotation.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              className="dismiss-btn"
              onClick={() => onDismiss(annotation.id)}
              aria-label="Dismiss annotation"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <p className="m-0 leading-snug">{annotation.text}</p>

            {/* Memory reference tooltip on hover */}
            {isHovered && annotation.memorySnippet && (
              <span className="memory-ref">
                {annotation.memoryDate && `${annotation.memoryDate} — `}
                {annotation.memorySnippet}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
