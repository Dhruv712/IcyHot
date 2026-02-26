"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { MarginAnnotation } from "@/hooks/useMarginIntelligence";

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
  const [positions, setPositions] = useState<Map<number, number>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const recalcRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recalcPositions = useCallback(() => {
    if (!editorElement) return;
    const proseMirror = editorElement.querySelector(".ProseMirror");
    if (!proseMirror) return;

    const newPositions = new Map<number, number>();
    const children = proseMirror.children;

    for (const annotation of annotations) {
      const el = children[annotation.paragraphIndex] as HTMLElement | undefined;
      if (el) {
        newPositions.set(annotation.paragraphIndex, el.offsetTop);
      }
    }

    setPositions(newPositions);
  }, [editorElement, annotations]);

  // Recalculate positions when annotations or editor content changes
  useEffect(() => {
    recalcPositions();

    // Also watch for content changes via ResizeObserver
    if (!editorElement) return;
    const proseMirror = editorElement.querySelector(".ProseMirror");
    if (!proseMirror) return;

    const observer = new ResizeObserver(() => {
      // Debounce recalcs slightly
      if (recalcRef.current) clearTimeout(recalcRef.current);
      recalcRef.current = setTimeout(recalcPositions, 100);
    });
    observer.observe(proseMirror);

    return () => {
      observer.disconnect();
      if (recalcRef.current) clearTimeout(recalcRef.current);
    };
  }, [editorElement, recalcPositions]);

  if (annotations.length === 0) return null;

  return (
    <>
      {annotations.map((annotation) => {
        const top = positions.get(annotation.paragraphIndex);
        if (top === undefined) return null;

        const isHovered = hoveredId === annotation.id;

        return (
          <div
            key={annotation.id}
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
