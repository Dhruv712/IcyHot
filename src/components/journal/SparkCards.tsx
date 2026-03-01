"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/ui/Modal";
import type { MarginDownReason } from "@/lib/marginSpark";
import type { SparkNudgeCard } from "@/hooks/useMarginIntelligence";

const CARD_GAP = 10;

interface SparkCardsProps {
  nudges: SparkNudgeCard[];
  editorElement: HTMLElement | null;
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
  onDismiss,
  onExpand,
  onFeedback,
}: SparkCardsProps) {
  const [resolvedPositions, setResolvedPositions] = useState<Map<string, number>>(new Map());
  const [revisitId, setRevisitId] = useState<string | null>(null);
  const [reasonOpenForId, setReasonOpenForId] = useState<string | null>(null);
  const recalcRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const recalcPositions = useCallback(() => {
    if (!editorElement) return;
    const proseMirror = editorElement.querySelector(".ProseMirror");
    if (!proseMirror) return;

    const children = proseMirror.children;
    const sorted = nudges
      .map((nudge) => {
        const el = children[nudge.paragraphIndex] as HTMLElement | undefined;
        return { nudge, naturalTop: el ? el.offsetTop : -1 };
      })
      .filter((item) => item.naturalTop >= 0)
      .sort((a, b) => a.naturalTop - b.naturalTop);

    const newPositions = new Map<string, number>();
    let prevBottom = -Infinity;

    for (const { nudge, naturalTop } of sorted) {
      const cardEl = cardRefs.current.get(nudge.id);
      const cardHeight = cardEl ? cardEl.offsetHeight : nudge.collapsed ? 78 : 210;
      const resolvedTop = Math.max(naturalTop, prevBottom + CARD_GAP);
      newPositions.set(nudge.id, resolvedTop);
      prevBottom = resolvedTop + cardHeight;
    }

    setResolvedPositions(newPositions);
  }, [editorElement, nudges]);

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

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (recalcRef.current) clearTimeout(recalcRef.current);
    };
  }, [editorElement, recalcPositions]);

  if (nudges.length === 0) return null;

  const revisitNudge = revisitId ? nudges.find((n) => n.id === revisitId) : null;

  return (
    <>
      {nudges.map((nudge) => {
        const top = resolvedPositions.get(nudge.id);
        if (top === undefined) return null;

        const showReasonPicker = reasonOpenForId === nudge.id;

        if (nudge.collapsed) {
          return (
            <button
              key={nudge.id}
              ref={(el) => {
                if (el) cardRefs.current.set(nudge.id, el);
                else cardRefs.current.delete(nudge.id);
              }}
              className={`spark-chip spark-chip--${nudge.type}`}
              style={{ top }}
              onClick={() => onExpand(nudge.id)}
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
          );
        }

        return (
          <div
            key={nudge.id}
            ref={(el) => {
              if (el) cardRefs.current.set(nudge.id, el);
              else cardRefs.current.delete(nudge.id);
            }}
            className={`spark-card spark-card--${nudge.type}`}
            style={{ top }}
          >
            <button
              className="spark-card__collapse"
              onClick={() => onExpand(nudge.id)}
              aria-label="Collapse comment"
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
