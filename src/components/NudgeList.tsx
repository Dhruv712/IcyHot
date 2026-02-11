"use client";

import type { GraphNode } from "./graph/types";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import { useLogInteraction } from "@/hooks/useInteractions";

interface NudgeListProps {
  nodes: GraphNode[];
  onNodeSelect: (node: GraphNode) => void;
}

export default function NudgeList({ nodes, onNodeSelect }: NudgeListProps) {
  const logInteraction = useLogInteraction();

  // Sort by nudge score (importance * coldness), take top 8
  const nudges = [...nodes]
    .filter((n) => n.nudgeScore > 0)
    .sort((a, b) => b.nudgeScore - a.nudgeScore)
    .slice(0, 8);

  if (nudges.length === 0) return null;

  return (
    <div className="fixed left-4 bottom-4 w-72 bg-gray-950/95 border border-gray-800 rounded-xl backdrop-blur-sm z-30 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white">Reach out to</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Important connections going cold
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {nudges.map((node) => (
          <div
            key={node.id}
            className="flex items-center gap-3 px-4 py-2 hover:bg-gray-900/50 cursor-pointer transition-colors group"
            onClick={() => onNodeSelect(node)}
          >
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: node.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{node.name}</div>
              <div className="text-xs text-gray-500">
                {temperatureLabel(node.temperature)} &middot;{" "}
                {node.lastInteraction
                  ? formatDate(new Date(node.lastInteraction))
                  : "Never contacted"}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                logInteraction.mutate({ contactId: node.id });
              }}
              className="opacity-0 group-hover:opacity-100 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-all"
            >
              Pinged
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
