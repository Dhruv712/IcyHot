"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/ui/Modal";
import type { MarginDownReason } from "@/lib/marginSpark";
import type { SparkNudgeCard } from "@/hooks/useMarginIntelligence";
import {
  collectMarginAnchorTargets,
  resolveMarginAnchor,
} from "./marginPositioning";

const CARD_GAP = 10;

interface SparkCardsProps {
  nudges: SparkNudgeCard[];
  editorElement: HTMLElement | null;
  compactMode?: boolean;
  onDismiss: (id: string) => void;
  onExpand: (id: string) => void;
  onFeedback: (
    nudgeId: string,
    feedback: "up" | "down",
    reason?: MarginDownReason,
  ) => void;
}

const downvoteReasons: Array<{ value: MarginDownReason; label: string }> = [
  { value: "too_vague", label: "Too vague" },
  { value: "wrong_connection", label: "Wrong connection" },
  { value: "already_obvious", label: "Already obvious" },
  { value: "bad_tone", label: "Bad tone" },
  { value: "not_now", label: "Not now" },
];

function typeLabel(type: SparkNudgeCard["type"]): string {
  if (type === "tension") return "Tension";
  if (type === "callback") return "Callback";
  return "Eyebrow";
}

function shortDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function SparkCards({
  nudges,
  editorElement,
  compactMode = false,
  onDismiss,
  onExpand,
  onFeedback,
}: SparkCardsProps) {
  const [resolvedPositions, setResolvedPositions] = useState<Map<string, number>>(new Map());
  const [anchorPositions, setAnchorPositions] = useState<Map<string, number>>(new Map());
  const [revisitId, setRevisitId] = useState<string | null>(null);
  const [reasonOpenForId, setReasonOpenForId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const recalcRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const recalcPositions = useCallback(() => {
    if (!editorElement) return;
    const targets = collectMarginAnchorTargets(editorElement);
    if (targets.length === 0) return;

    const sorted = nudges
      .map((nudge) => {
        const anchor = resolveMarginAnchor(targets, nudge.paragraphIndex, nudge.anchorText);
        return anchor ? { nudge, ...anchor } : null;
      })
      .filter((item): item is { nudge: SparkNudgeCard; naturalTop: number; anchorY: number } => Boolean(item))
      .sort((a, b) => a.naturalTop - b.naturalTop);

    const newPositions = new Map<string, number>();
    const newAnchors = new Map<string, number>();
    let prevBottom = -Infinity;

    for (const { nudge, naturalTop, anchorY } of sorted) {
      const cardEl = cardRefs.current.get(nudge.id);
      const isPreviewOnly = compactMode && hoveredId !== nudge.id;
      const cardHeight = cardEl
        ? cardEl.offsetHeight
        : isPreviewOnly || nudge.collapsed
          ? 18
          : 210;
      const resolvedTop = Math.max(naturalTop, prevBottom + CARD_GAP);
      newPositions.set(nudge.id, resolvedTop);
      newAnchors.set(nudge.id, anchorY);
      prevBottom = resolvedTop + (isPreviewOnly ? 12 : cardHeight);
    }

    setResolvedPositions(newPositions);
    setAnchorPositions(newAnchors);
  }, [compactMode, editorElement, hoveredId, nudges]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      recalcPositions();
    });

    if (!editorElement) return;
    const proseMirror = editorElement.querySelector(".ProseMirror");
    if (!proseMirror) return;

    const observer = new ResizeObserver(() => {
      if (recalcRef.current) clearTimeout(recalcRef.current);
      recalcRef.current = setTimeout(recalcPositions, 100);
    });
    observer.observe(proseMirror);

    const mutationObserver = new MutationObserver(() => {
      if (recalcRef.current) clearTimeout(recalcRef.current);
      recalcRef.current = setTimeout(recalcPositions, 16);
    });
    mutationObserver.observe(proseMirror, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      mutationObserver.disconnect();
      if (recalcRef.current) clearTimeout(recalcRef.current);
    };
  }, [editorElement, recalcPositions]);

  if (nudges.length === 0) return null;

  const revisitNudge = revisitId ? nudges.find((n) => n.id === revisitId) : null;

  return (
    <>
      {nudges.map((nudge) => {
        const top = resolvedPositions.get(nudge.id);
        const anchorY = anchorPositions.get(nudge.id);
        if (top === undefined || anchorY === undefined) return null;

        const showReasonPicker = reasonOpenForId === nudge.id;
        const showCompactPreview = compactMode && hoveredId !== nudge.id;
        const isExpanded = !nudge.collapsed || (compactMode && hoveredId === nudge.id);
        const targetY = top + (showCompactPreview ? 6 : nudge.collapsed ? 20 : 105);
        const connectorTop = Math.min(anchorY, targetY);
        const connectorHeight = Math.max(2, Math.abs(anchorY - targetY) + 2);
        const connectorStartY = anchorY - connectorTop;
        const connectorEndY = targetY - connectorTop;

        if (showCompactPreview) {
          return (
            <div key={nudge.id}>
              <svg
                className="pointer-events-none absolute"
                style={{ top: connectorTop, left: "calc(100% + 4px)" }}
                width="24"
                height={connectorHeight}
                viewBox={`0 0 24 ${connectorHeight}`}
                fill="none"
              >
                <path
                  d={`M0 ${connectorStartY} C 8 ${connectorStartY}, 10 ${connectorEndY}, 24 ${connectorEndY}`}
                  stroke="var(--border-medium)"
                  strokeWidth="1"
                  opacity="0.7"
                />
              </svg>
              <div
                ref={(el) => {
                  if (el) cardRefs.current.set(nudge.id, el);
                  else cardRefs.current.delete(nudge.id);
                }}
                className={`spark-dot spark-dot--${nudge.type}`}
                style={{ top }}
                onMouseEnter={() => setHoveredId(nudge.id)}
                onMouseLeave={() => setHoveredId((current) => (current === nudge.id ? null : current))}
              />
            </div>
          );
        }

        if (nudge.collapsed && !isExpanded) {
          return (
            <div key={nudge.id}>
              <svg
                className="pointer-events-none absolute"
                style={{ top: connectorTop, left: "calc(100% + 4px)" }}
                width="24"
                height={connectorHeight}
                viewBox={`0 0 24 ${connectorHeight}`}
                fill="none"
              >
                <path
                  d={`M0 ${connectorStartY} C 8 ${connectorStartY}, 10 ${connectorEndY}, 24 ${connectorEndY}`}
                  stroke="var(--border-medium)"
                  strokeWidth="1"
                  opacity="0.7"
                />
              </svg>
              <button
                ref={(el) => {
                  if (el) cardRefs.current.set(nudge.id, el);
                  else cardRefs.current.delete(nudge.id);
                }}
                className={`spark-chip spark-chip--${nudge.type}`}
                style={{ top }}
                onClick={() => onExpand(nudge.id)}
                onMouseEnter={() => compactMode && setHoveredId(nudge.id)}
                onMouseLeave={() =>
                  compactMode && setHoveredId((current) => (current === nudge.id ? null : current))
                }
                title="Open comment"
              >
                <span className="spark-chip__rail" />
                <span className="spark-chip__body">
                  <span className="spark-chip__hook">{nudge.hook}</span>
                  <span className="spark-chip__meta">
                    {typeLabel(nudge.type)}
                    {nudge.evidenceMemoryDate ? ` · ${shortDate(nudge.evidenceMemoryDate)}` : ""}
                  </span>
                </span>
              </button>
            </div>
          );
        }

        return (
          <div key={nudge.id}>
            <svg
              className="pointer-events-none absolute"
              style={{ top: connectorTop, left: "calc(100% + 4px)" }}
              width="24"
              height={connectorHeight}
              viewBox={`0 0 24 ${connectorHeight}`}
              fill="none"
            >
              <path
                d={`M0 ${connectorStartY} C 8 ${connectorStartY}, 10 ${connectorEndY}, 24 ${connectorEndY}`}
                stroke="var(--border-medium)"
                strokeWidth="1"
                opacity="0.7"
              />
            </svg>
            <div
              ref={(el) => {
                if (el) cardRefs.current.set(nudge.id, el);
                else cardRefs.current.delete(nudge.id);
              }}
              className={`spark-card spark-card--${nudge.type}`}
              style={{ top }}
              onMouseEnter={() => compactMode && setHoveredId(nudge.id)}
              onMouseLeave={() =>
                compactMode && setHoveredId((current) => (current === nudge.id ? null : current))
              }
            >
              <button
                className="spark-card__collapse"
                onClick={() => {
                  if (compactMode) {
                    setHoveredId(null);
                    return;
                  }
                  onExpand(nudge.id);
                }}
                aria-label={compactMode ? "Hide comment" : "Collapse comment"}
              >
                −
              </button>

              <div className="spark-card__type">
                {typeLabel(nudge.type)}
                {nudge.evidenceMemoryDate ? ` · ${shortDate(nudge.evidenceMemoryDate)}` : ""}
              </div>
              <p className="spark-card__hook">{nudge.hook}</p>

              <div className="spark-card__detail">
                <div className="spark-card__label">Why</div>
                <div className="spark-card__text">{nudge.whyNow}</div>
              </div>

              <div className="spark-card__detail">
                <div className="spark-card__label">Memory</div>
                <div className="spark-card__text">
                  {nudge.evidenceMemorySnippet || "Memory link"}
                </div>
              </div>

              <div className="spark-card__detail spark-card__detail--ask">
                <div className="spark-card__label">Ask</div>
                <div className="spark-card__text spark-card__text--strong">
                  {nudge.actionPrompt}
                </div>
              </div>

              <div className="spark-card__controls">
                <button
                  className={`spark-btn ${nudge.feedback?.value === "up" ? "spark-btn--active" : ""}`}
                  disabled={nudge.feedbackPending}
                  onClick={() => {
                    setReasonOpenForId(null);
                    onFeedback(nudge.id, "up");
                  }}
                >
                  Useful
                </button>

                <button
                  className={`spark-btn ${nudge.feedback?.value === "down" ? "spark-btn--active" : ""}`}
                  disabled={nudge.feedbackPending}
                  onClick={() => {
                    if (nudge.feedback?.value === "down") return;
                    setReasonOpenForId((prev) => (prev === nudge.id ? null : nudge.id));
                  }}
                >
                  Not useful
                </button>

                <button
                  className="spark-btn"
                  onClick={() => setRevisitId(nudge.id)}
                  disabled={nudge.feedbackPending}
                >
                  Open
                </button>
                <button
                  className="spark-btn"
                  onClick={() => onDismiss(nudge.id)}
                  disabled={nudge.feedbackPending}
                >
                  Hide
                </button>
              </div>

              {showReasonPicker && (
                <div className="spark-card__reason-grid">
                  {downvoteReasons.map((reason) => (
                    <button
                      key={reason.value}
                      className="spark-reason"
                      onClick={() => {
                        setReasonOpenForId(null);
                        onFeedback(nudge.id, "down", reason.value);
                      }}
                    >
                      {reason.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {revisitNudge && (
        <Modal onClose={() => setRevisitId(null)} maxWidth="md">
          <ModalHeader onClose={() => setRevisitId(null)}>
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Spark Revisit
              </div>
              <div className="text-sm text-[var(--text-secondary)] mt-0.5">
                {typeLabel(revisitNudge.type)}
              </div>
            </div>
          </ModalHeader>
          <ModalBody className="space-y-4 text-sm text-[var(--text-secondary)]">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Hook
              </div>
              <p className="mt-1">{revisitNudge.hook}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Why now
              </div>
              <p className="mt-1">{revisitNudge.whyNow}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Evidence
              </div>
              <p className="mt-1">
                {revisitNudge.evidenceMemoryDate
                  ? `${revisitNudge.evidenceMemoryDate} · `
                  : ""}
                {revisitNudge.evidenceMemorySnippet || "No snippet available."}
              </p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Suggested next move
              </div>
              <p className="mt-1">{revisitNudge.actionPrompt}</p>
            </div>
          </ModalBody>
        </Modal>
      )}
    </>
  );
}
