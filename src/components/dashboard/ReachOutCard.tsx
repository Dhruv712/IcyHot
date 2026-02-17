"use client";

import { useState, useCallback } from "react";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import { useDailySuggestions } from "@/hooks/useSuggestions";
import { useLogInteraction } from "@/hooks/useInteractions";

const PINGED_KEY_PREFIX = "icyhot-daily-pinged-";

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadPingedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(PINGED_KEY_PREFIX + getTodayStr());
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function savePingedIds(ids: Set<string>) {
  localStorage.setItem(PINGED_KEY_PREFIX + getTodayStr(), JSON.stringify([...ids]));
}

interface ReachOutCardProps {
  onInteractionLogged?: (nodeId: string) => void;
}

export default function ReachOutCard({ onInteractionLogged }: ReachOutCardProps) {
  const [pingedIds, setPingedIds] = useState<Set<string>>(loadPingedIds);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { data, isLoading } = useDailySuggestions();
  const logInteraction = useLogInteraction();

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

  if (isLoading || !data?.suggestions?.length) return null;

  const suggestions = data.suggestions;
  const allPinged = suggestions.every((s) => pingedIds.has(s.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle icon="👋">
          {allPinged ? "All done for today!" : "Reach Out Today"}
        </CardTitle>
      </CardHeader>
      {allPinged ? (
        <div className="text-center py-4">
          <div className="text-2xl mb-1">🎉</div>
          <p className="text-xs text-[var(--text-muted)]">
            You reached out to everyone today.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => {
            const isPinged = pingedIds.has(s.id);
            const isExpanded = expandedId === s.id;
            return (
              <div
                key={s.id}
                className={`${isPinged ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  {isPinged ? (
                    <div className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 bg-[var(--success)]/20 flex items-center justify-center">
                      <span className="text-[var(--success)] text-[10px]">✓</span>
                    </div>
                  ) : (
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: s.color }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${isPinged ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>
                      {s.name}
                    </div>
                    {!isPinged && (
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                        {s.blurb}
                      </div>
                    )}
                  </div>
                  {!isPinged && !isExpanded && (
                    <button
                      onClick={() => { setExpandedId(s.id); setNote(""); }}
                      disabled={logInteraction.isPending}
                      className="text-xs bg-[var(--amber)] hover:bg-[var(--amber-hover)] disabled:opacity-50 text-[var(--bg-base)] font-medium px-2.5 py-1 rounded-lg transition-colors flex-shrink-0 mt-0.5"
                    >
                      Pinged
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div className="mt-2 ml-6 flex items-center gap-2">
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What about? (optional)"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handlePinged(s.id, note);
                        if (e.key === "Escape") { setExpandedId(null); setNote(""); }
                      }}
                      className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                    />
                    <button
                      onClick={() => handlePinged(s.id, note)}
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
      )}
    </Card>
  );
}
