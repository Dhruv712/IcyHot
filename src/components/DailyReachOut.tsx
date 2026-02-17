"use client";

import { useState, useCallback } from "react";
import { useDailySuggestions } from "@/hooks/useSuggestions";
import { useLogInteraction } from "@/hooks/useInteractions";
import type { GraphNode } from "./graph/types";

interface DailyReachOutProps {
  nodes: GraphNode[];
  onNodeSelect: (node: GraphNode) => void;
  onInteractionLogged?: (nodeId: string) => void;
}

const DISMISS_KEY_PREFIX = "icyhot-daily-dismiss-";
const PINGED_KEY_PREFIX = "icyhot-daily-pinged-";

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDismissKey(): string {
  return DISMISS_KEY_PREFIX + getTodayStr();
}

function getPingedKey(): string {
  return PINGED_KEY_PREFIX + getTodayStr();
}

function loadPingedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(getPingedKey());
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function savePingedIds(ids: Set<string>) {
  localStorage.setItem(getPingedKey(), JSON.stringify([...ids]));
}

export default function DailyReachOut({
  nodes,
  onNodeSelect,
  onInteractionLogged,
}: DailyReachOutProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(getDismissKey()) === "1";
  });

  const [pingedIds, setPingedIds] = useState<Set<string>>(loadPingedIds);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useDailySuggestions();
  const logInteraction = useLogInteraction();

  const handleDismiss = useCallback(() => {
    localStorage.setItem(getDismissKey(), "1");
    setDismissed(true);
  }, []);

  const handleOpen = useCallback(
    (contactId: string) => {
      const fullNode = nodes.find((n) => n.id === contactId);
      if (fullNode) onNodeSelect(fullNode);
    },
    [nodes, onNodeSelect]
  );

  const handlePinged = useCallback(
    (contactId: string, pingNote?: string) => {
      logInteraction.mutate(
        { contactId, note: pingNote || undefined },
        {
          onSuccess: () => {
            const next = new Set(pingedIds);
            next.add(contactId);
            setPingedIds(next);
            savePingedIds(next);
            setExpandedId(null);
            setNote("");
            onInteractionLogged?.(contactId);
          },
        }
      );
    },
    [logInteraction, pingedIds, onInteractionLogged]
  );

  if (dismissed || isLoading || !data?.suggestions?.length || nodes.length === 0) {
    return null;
  }

  const suggestions = data.suggestions;
  const allPinged = suggestions.every((s) => pingedIds.has(s.id));

  return (
    <div className="absolute top-4 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto bg-[var(--bg-card)]/95 backdrop-blur-sm border border-[var(--border-subtle)] rounded-2xl px-5 py-4 max-w-xl w-full shadow-2xl"
        style={{ animation: "slideDown 0.3s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {allPinged ? "All done for today!" : "Today\u2019s reach outs"}
          </h3>
          <button
            onClick={handleDismiss}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-lg leading-none -mr-1"
          >
            &times;
          </button>
        </div>

        {/* Completion message */}
        {allPinged && (
          <div className="text-center py-2 mb-1">
            <div className="text-2xl mb-1">&#127881;</div>
            <p className="text-xs text-[var(--text-muted)]">
              You reached out to everyone today. Your network thanks you.
            </p>
          </div>
        )}

        {/* Suggestion rows */}
        <div className="space-y-3">
          {suggestions.map((suggestion) => {
            const isPinged = pingedIds.has(suggestion.id);
            const isExpanded = expandedId === suggestion.id;

            return (
              <div
                key={suggestion.id}
                className={`transition-opacity duration-300 ${
                  isPinged ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkmark or temperature dot */}
                  {isPinged ? (
                    <div className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 bg-[var(--success)]/20 flex items-center justify-center">
                      <span className="text-[var(--success)] text-[10px]">&#10003;</span>
                    </div>
                  ) : (
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: suggestion.color }}
                    />
                  )}

                  {/* Text content */}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-medium ${
                        isPinged
                          ? "text-[var(--text-muted)] line-through"
                          : "text-[var(--text-primary)]"
                      }`}
                    >
                      {suggestion.name}
                    </div>
                    {!isPinged && (
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                        {suggestion.blurb}
                      </div>
                    )}
                  </div>

                  {/* Actions — only show for un-pinged */}
                  {!isPinged && !isExpanded && (
                    <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                      <button
                        onClick={() => handleOpen(suggestion.id)}
                        className="text-[11px] text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors px-1.5 py-1"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => { setExpandedId(suggestion.id); setNote(""); }}
                        disabled={logInteraction.isPending}
                        className="text-[11px] bg-[var(--amber)] hover:bg-[var(--amber-hover)] disabled:opacity-50 text-[var(--bg-base)] font-medium px-2.5 py-1 rounded-lg transition-colors"
                      >
                        Pinged
                      </button>
                    </div>
                  )}
                </div>

                {/* Expandable note input */}
                {isExpanded && (
                  <div className="mt-2 ml-6 flex items-center gap-2">
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What about? (optional)"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handlePinged(suggestion.id, note);
                        if (e.key === "Escape") { setExpandedId(null); setNote(""); }
                      }}
                      className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                    />
                    <button
                      onClick={() => handlePinged(suggestion.id, note)}
                      disabled={logInteraction.isPending}
                      className="text-xs bg-[var(--amber)] hover:bg-[var(--amber-hover)] disabled:opacity-50 text-[var(--bg-base)] font-medium px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
                    >
                      Log
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
