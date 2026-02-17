"use client";

import { useState, useRef, useEffect } from "react";
import type { GraphNode, GraphGroup } from "./graph/types";
import { useLogInteraction } from "@/hooks/useInteractions";

interface QuickLogButtonProps {
  nodes: GraphNode[];
  groups: GraphGroup[];
  onInteractionLogged?: (nodeId: string) => void;
}

const SENTIMENTS = [
  { value: "great" as const, emoji: "❤️", label: "Great" },
  { value: "good" as const, emoji: "👍", label: "Good" },
  { value: "neutral" as const, emoji: "😐", label: "Neutral" },
  { value: "awkward" as const, emoji: "😬", label: "Awkward" },
];

export default function QuickLogButton({ nodes, groups, onInteractionLogged }: QuickLogButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logInteraction = useLogInteraction();

  const [occurredAt, setOccurredAt] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    if (open && !confirmed) {
      inputRef.current?.focus();
    }
  }, [open, confirmed]);

  // Keyboard shortcut: press 'l' to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "l" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        resetState();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const contactNodes = nodes.filter((n) => n.id !== "me");

  const filtered = contactNodes.filter((n) =>
    n.name.toLowerCase().includes(search.toLowerCase())
  );

  const groupsWithMembers = groups
    .map((g) => ({
      ...g,
      members: contactNodes.filter((n) => n.groupIds.includes(g.id)),
    }))
    .filter((g) => g.members.length >= 2);

  const toggleNode = (nodeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const selectGroup = (groupId: string) => {
    const memberIds = contactNodes
      .filter((n) => n.groupIds.includes(groupId))
      .map((n) => n.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = memberIds.every((id) => next.has(id));
      if (allSelected) {
        memberIds.forEach((id) => next.delete(id));
      } else {
        memberIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (selectedIds.size > 0) {
      setConfirmed(true);
    }
  };

  const handleSingleSelect = (node: GraphNode) => {
    setSelectedIds(new Set([node.id]));
    setConfirmed(true);
  };

  const handleLogWithSentiment = async (sentiment?: "great" | "good" | "neutral" | "awkward") => {
    if (selectedIds.size === 0) return;
    setLogging(true);

    const ids = Array.from(selectedIds);
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            logInteraction.mutate(
              { contactId: id, sentiment, occurredAt: occurredAt || undefined },
              {
                onSuccess: () => {
                  onInteractionLogged?.(id);
                  resolve();
                },
                onError: () => resolve(),
              }
            );
          })
      )
    );

    setLogging(false);
    setOpen(false);
    resetState();
  };

  const resetState = () => {
    setSearch("");
    setSelectedIds(new Set());
    setConfirmed(false);
    setOccurredAt("");
    setShowDatePicker(false);
    setLogging(false);
  };

  const handleClose = () => {
    setOpen(false);
    resetState();
  };

  const selectedNodes = contactNodes.filter((n) => selectedIds.has(n.id));

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 w-12 h-12 bg-[var(--amber)] hover:bg-[var(--amber-hover)] text-[var(--bg-base)] rounded-full shadow-lg shadow-[var(--amber)]/25 flex items-center justify-center text-xl z-30 transition-colors font-medium"
        title="Log interaction (L)"
      >
        +
      </button>

      {/* Quick log modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-32">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleClose}
          />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            {!confirmed ? (
              <>
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Who did you hang out with?"
                  className="w-full bg-transparent px-4 py-3 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none border-b border-[var(--border-subtle)]"
                />

                {/* Group shortcuts */}
                {!search && groupsWithMembers.length > 0 && (
                  <div className="px-4 pt-3 pb-1 flex flex-wrap gap-1.5">
                    {groupsWithMembers.map((g) => {
                      const allSelected = g.members.every((m) => selectedIds.has(m.id));
                      return (
                        <button
                          key={g.id}
                          onClick={() => selectGroup(g.id)}
                          className={`text-xs px-2.5 py-1 rounded-full transition-all border ${
                            allSelected
                              ? "bg-[var(--amber-ghost-bg)] border-[var(--amber)] text-[var(--amber)]"
                              : "bg-[var(--bg-elevated)] border-[var(--border-medium)] text-[var(--text-muted)] hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
                          }`}
                        >
                          {g.name} ({g.members.length})
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Selected count + next button */}
                {selectedIds.size > 0 && (
                  <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      {selectedNodes.slice(0, 5).map((n) => (
                        <span
                          key={n.id}
                          className="text-xs bg-[var(--bg-elevated)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full flex items-center gap-1"
                        >
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: n.color }} />
                          {n.name}
                        </span>
                      ))}
                      {selectedIds.size > 5 && (
                        <span className="text-xs text-[var(--text-muted)]">+{selectedIds.size - 5} more</span>
                      )}
                    </div>
                    <button
                      onClick={handleConfirm}
                      className="text-xs bg-[var(--amber)] hover:bg-[var(--amber-hover)] text-[var(--bg-base)] font-medium px-3 py-1 rounded-lg transition-colors ml-2 flex-shrink-0"
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}

                {/* Contact list with checkboxes */}
                <div className="max-h-48 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-muted)]">
                      No contacts found
                    </div>
                  ) : (
                    filtered.map((node) => {
                      const isSelected = selectedIds.has(node.id);
                      return (
                        <div
                          key={node.id}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors text-left"
                        >
                          <button
                            onClick={() => toggleNode(node.id)}
                            className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                              isSelected
                                ? "bg-[var(--amber)] border-[var(--amber)]"
                                : "border-[var(--border-medium)] hover:border-[var(--text-muted)]"
                            }`}
                          >
                            {isSelected && (
                              <svg className="w-2.5 h-2.5 text-[var(--bg-base)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => handleSingleSelect(node)}
                            className="flex items-center gap-2 flex-1 min-w-0"
                          >
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: node.color }}
                            />
                            <span className="text-sm text-[var(--text-primary)] truncate">{node.name}</span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="p-5">
                {/* Show who we're logging for */}
                <div className="text-center mb-3">
                  <div className="text-sm text-[var(--text-secondary)]">
                    {selectedIds.size === 1 ? "Talked to" : "Hung out with"}
                  </div>
                  <div className="text-lg font-semibold text-[var(--text-primary)]">
                    {selectedIds.size <= 3
                      ? selectedNodes.map((n) => n.name).join(", ")
                      : `${selectedNodes.slice(0, 2).map((n) => n.name).join(", ")} & ${selectedIds.size - 2} more`}
                  </div>
                </div>

                {/* Date picker */}
                <div className="flex justify-center mb-3">
                  {!showDatePicker ? (
                    <button
                      onClick={() => setShowDatePicker(true)}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors bg-[var(--bg-elevated)] hover:bg-[var(--bg-base)] px-2 py-1 rounded-lg"
                    >
                      {occurredAt
                        ? new Date(occurredAt + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                        : "\uD83D\uDCC5 Today"}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={occurredAt || new Date().toISOString().slice(0, 10)}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setOccurredAt(e.target.value)}
                        className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--amber)] [color-scheme:dark]"
                      />
                      <button
                        onClick={() => { setOccurredAt(""); setShowDatePicker(false); }}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors px-1"
                        title="Reset to today"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Sentiment */}
                <div className="text-xs text-[var(--text-muted)] text-center mb-2">How&apos;d it go?</div>
                <div className="flex justify-center gap-2 mb-3">
                  {SENTIMENTS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => handleLogWithSentiment(s.value)}
                      disabled={logging}
                      className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--amber-ghost-bg)] transition-colors disabled:opacity-50"
                    >
                      <span className="text-xl">{s.emoji}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{s.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => handleLogWithSentiment()}
                  disabled={logging}
                  className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors py-1 disabled:opacity-50"
                >
                  {logging ? "Logging..." : "Skip \u2014 just log it"}
                </button>

                {/* Back button */}
                <button
                  onClick={() => setConfirmed(false)}
                  className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors py-1 mt-1"
                >
                  &larr; Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
