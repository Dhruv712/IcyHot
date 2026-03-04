"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { MarginAnnotation } from "@/hooks/useMarginIntelligence";
import {
  collectMarginAnchorTargets,
  resolveMarginAnchor,
} from "./marginPositioning";

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
  const [anchorPositions, setAnchorPositions] = useState<Map<string, number>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const recalcRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const recalcPositions = useCallback(() => {
    if (!editorElement) return;
    const targets = collectMarginAnchorTargets(editorElement);
    if (targets.length === 0) return;

    // 1. Get natural (paragraph-aligned) top for each annotation, sorted by position
    const sorted = annotations
      .map((a) => {
        const anchor = resolveMarginAnchor(targets, a.paragraphIndex, a.anchorText);
        return anchor ? { annotation: a, ...anchor } : null;
      })
      .filter((item): item is { annotation: MarginAnnotation; naturalTop: number; anchorY: number } => Boolean(item))
      .sort((a, b) => a.naturalTop - b.naturalTop);

    // 2. Walk top-down and push each card below the previous if they'd overlap
    const newPositions = new Map<string, number>();
    const newAnchors = new Map<string, number>();
    let prevBottom = -Infinity;

    for (const { annotation, naturalTop, anchorY } of sorted) {
      const cardEl = cardRefs.current.get(annotation.id);
      const cardHeight = cardEl ? cardEl.offsetHeight : 60; // fallback estimate

      const resolvedTop = Math.max(naturalTop, prevBottom + ANNOTATION_GAP);
      newPositions.set(annotation.id, resolvedTop);
      newAnchors.set(annotation.id, anchorY);
      prevBottom = resolvedTop + cardHeight;
    }

    setResolvedPositions(newPositions);
    setAnchorPositions(newAnchors);
  }, [editorElement, annotations]);

  // Recalculate positions when annotations or editor content changes
  useEffect(() => {
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
        const anchorY = anchorPositions.get(annotation.id);
        if (top === undefined || anchorY === undefined) return null;

        const isHovered = hoveredId === annotation.id;
        const connectorTop = Math.min(anchorY, top + 12);
        const connectorHeight = Math.max(2, Math.abs(anchorY - (top + 12)) + 2);
        const connectorStartY = anchorY - connectorTop;
        const connectorEndY = top + 12 - connectorTop;

        return (
          <div key={annotation.id}>
            <svg
              className="pointer-events-none absolute"
              style={{ top: connectorTop, left: "calc(100% + 4px)" }}
              width="26"
              height={connectorHeight}
              viewBox={`0 0 26 ${connectorHeight}`}
              fill="none"
            >
              <path
                d={`M0 ${connectorStartY} C 8 ${connectorStartY}, 10 ${connectorEndY}, 26 ${connectorEndY}`}
                stroke="var(--border-medium)"
                strokeWidth="1"
                opacity="0.7"
              />
            </svg>

            <div
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
          </div>
        );
      })}
    </>
  );
}
