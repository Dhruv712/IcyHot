"use client";

import { useState, useRef, useEffect } from "react";
import type { GraphNode } from "./graph/types";
import { useLogInteraction } from "@/hooks/useInteractions";

interface QuickLogButtonProps {
  nodes: GraphNode[];
}

export default function QuickLogButton({ nodes }: QuickLogButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
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

  const handleLog = (node: GraphNode) => {
    logInteraction.mutate({ contactId: node.id });
    setOpen(false);
    setSearch("");
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
            onClick={() => {
              setOpen(false);
              setSearch("");
            }}
          />
          <div className="relative bg-gray-950 border border-gray-800 rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
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
                    onClick={() => handleLog(node)}
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
          </div>
        </div>
      )}
    </>
  );
}
