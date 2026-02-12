"use client";

import { useState, useRef, useEffect } from "react";
import type { GraphNode } from "./graph/types";
import { useLogInteraction } from "@/hooks/useInteractions";

interface QuickLogButtonProps {
  nodes: GraphNode[];
  onInteractionLogged?: (nodeId: string) => void;
}

const SENTIMENTS = [
  { value: "great" as const, emoji: "❤️", label: "Great" },
  { value: "good" as const, emoji: "👍", label: "Good" },
  { value: "neutral" as const, emoji: "😐", label: "Neutral" },
  { value: "awkward" as const, emoji: "😬", label: "Awkward" },
];

export default function QuickLogButton({ nodes, onInteractionLogged }: QuickLogButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logInteraction = useLogInteraction();

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

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
        setSearch("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filtered = nodes.filter((n) =>
    n.name.toLowerCase().includes(search.toLowerCase())
  );

  const [occurredAt, setOccurredAt] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleSelectNode = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const handleLogWithSentiment = (sentiment?: "great" | "good" | "neutral" | "awkward") => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    logInteraction.mutate(
      { contactId: nodeId, sentiment, occurredAt: occurredAt || undefined },
      { onSuccess: () => onInteractionLogged?.(nodeId) }
    );
    setOpen(false);
    setSearch("");
    setSelectedNode(null);
    setOccurredAt("");
    setShowDatePicker(false);
  };

  const handleClose = () => {
    setOpen(false);
    setSearch("");
    setSelectedNode(null);
    setOccurredAt("");
    setShowDatePicker(false);
  };

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 w-12 h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg shadow-blue-600/25 flex items-center justify-center text-xl z-30 transition-colors"
        title="Log interaction (L)"
      >
        +
      </button>

      {/* Quick log modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-32">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleClose}
          />
          <div className="relative bg-gray-950 border border-gray-800 rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
            {!selectedNode ? (
              <>
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Who did you talk to?"
                  className="w-full bg-transparent px-4 py-3 text-white placeholder-gray-500 focus:outline-none border-b border-gray-800"
                />
                <div className="max-h-48 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      No contacts found
                    </div>
                  ) : (
                    filtered.map((node) => (
                      <button
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-900 transition-colors text-left"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: node.color }}
                        />
                        <span className="text-sm text-white">{node.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="p-4">
                <div className="text-center mb-3">
                  <div className="text-sm text-gray-400">Talked to</div>
                  <div className="text-lg font-semibold text-white">{selectedNode.name}</div>
                </div>
                <div className="flex justify-center mb-3">
                  {!showDatePicker ? (
                    <button
                      onClick={() => setShowDatePicker(true)}
                      className="text-xs text-gray-400 hover:text-white transition-colors bg-gray-900 hover:bg-gray-800 px-2 py-1 rounded"
                    >
                      {occurredAt
                        ? new Date(occurredAt + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                        : "📅 Today"}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={occurredAt || new Date().toISOString().slice(0, 10)}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setOccurredAt(e.target.value)}
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-gray-500 [color-scheme:dark]"
                      />
                      <button
                        onClick={() => { setOccurredAt(""); setShowDatePicker(false); }}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-1"
                        title="Reset to today"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 text-center mb-2">How&apos;d it go?</div>
                <div className="flex justify-center gap-2 mb-3">
                  {SENTIMENTS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => handleLogWithSentiment(s.value)}
                      className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-xl">{s.emoji}</span>
                      <span className="text-[10px] text-gray-400">{s.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => handleLogWithSentiment()}
                  className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
                >
                  Skip — just log it
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
