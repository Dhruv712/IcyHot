"use client";

import { useState } from "react";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import { useLogInteraction } from "@/hooks/useInteractions";
import type { GraphNode } from "@/components/graph/types";

interface NudgesCardProps {
  nodes: GraphNode[];
  onInteractionLogged?: (nodeId: string) => void;
}

export default function NudgesCard({ nodes, onInteractionLogged }: NudgesCardProps) {
  const logInteraction = useLogInteraction();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const nudges = [...nodes]
    .filter((n) => n.nudgeScore > 0)
    .sort((a, b) => b.nudgeScore - a.nudgeScore)
    .slice(0, 8);

  if (nudges.length === 0) return null;

  const handlePinged = (contactId: string, pingNote?: string) => {
    logInteraction.mutate(
      { contactId, note: pingNote || undefined },
      {
        onSuccess: () => {
          setExpandedId(null);
          setNote("");
          onInteractionLogged?.(contactId);
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle icon="❄️">Going Cold</CardTitle>
        <span className="text-xs text-[var(--text-muted)]">Important connections cooling off</span>
      </CardHeader>
      <div className="space-y-1">
        {nudges.map((node) => {
          const isExpanded = expandedId === node.id;
          return (
            <div key={node.id}>
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-elevated)] transition-colors group"
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: node.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] truncate">{node.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {temperatureLabel(node.temperature)} &middot;{" "}
                    {node.lastInteraction
                      ? formatDate(new Date(node.lastInteraction))
                      : "Never contacted"}
                  </div>
                </div>
                {!isExpanded && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedId(node.id);
                      setNote("");
                    }}
                    className="opacity-0 group-hover:opacity-100 text-xs bg-[var(--amber)] hover:bg-[var(--amber-hover)] text-[var(--bg-base)] font-medium px-2.5 py-1 rounded-lg transition-all"
                  >
                    Pinged
                  </button>
                )}
              </div>
              {isExpanded && (
                <div className="ml-9 mr-3 mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What about? (optional)"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handlePinged(node.id, note);
                      if (e.key === "Escape") { setExpandedId(null); setNote(""); }
                    }}
                    className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                  />
                  <button
                    onClick={() => handlePinged(node.id, note)}
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
    </Card>
  );
}
