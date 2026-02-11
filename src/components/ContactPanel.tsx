"use client";

import { useState } from "react";
import type { GraphNode } from "./graph/types";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import { RELATIONSHIP_LABELS } from "@/lib/constants";
import { useContactInteractions, useLogInteraction } from "@/hooks/useInteractions";
import { useDeleteContact } from "@/hooks/useContacts";

interface ContactPanelProps {
  node: GraphNode;
  onClose: () => void;
}

export default function ContactPanel({ node, onClose }: ContactPanelProps) {
  const [note, setNote] = useState("");
  const { data: interactions } = useContactInteractions(node.id);
  const logInteraction = useLogInteraction();
  const deleteContact = useDeleteContact();

  const handleLogInteraction = () => {
    logInteraction.mutate(
      { contactId: node.id, note: note || undefined },
      {
        onSuccess: () => setNote(""),
      }
    );
  };

  const handleDelete = () => {
    if (confirm(`Remove ${node.name} from your network?`)) {
      deleteContact.mutate(node.id, { onSuccess: onClose });
    }
  };

  const tempPercent = Math.round(node.temperature * 100);

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-gray-950/95 border-l border-gray-800 backdrop-blur-sm z-40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{node.name}</h2>
            <p className="text-sm text-gray-400">
              {RELATIONSHIP_LABELS[node.relationshipType] || node.relationshipType}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Temperature bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Temperature</span>
            <span
              className="font-medium"
              style={{ color: node.color }}
            >
              {temperatureLabel(node.temperature)} ({tempPercent}%)
            </span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${tempPercent}%`,
                background: `linear-gradient(90deg, #3b82f6, ${node.color})`,
              }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-900 rounded px-2 py-1.5">
            <div className="text-gray-500">Importance</div>
            <div className="text-white font-medium">{node.importance}/10</div>
          </div>
          <div className="bg-gray-900 rounded px-2 py-1.5">
            <div className="text-gray-500">Last Contact</div>
            <div className="text-white font-medium">
              {node.lastInteraction
                ? formatDate(new Date(node.lastInteraction))
                : "Never"}
            </div>
          </div>
        </div>
      </div>

      {/* Log Interaction */}
      <div className="p-4 border-b border-gray-800">
        <h3 className="text-sm font-medium text-gray-300 mb-2">
          Log Interaction
        </h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you talk about? (optional)"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
          rows={2}
        />
        <button
          onClick={handleLogInteraction}
          disabled={logInteraction.isPending}
          className="mt-2 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          {logInteraction.isPending ? "Logging..." : "I talked to them"}
        </button>
      </div>

      {/* Interaction History */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-2">
          History ({node.interactionCount})
        </h3>
        <div className="space-y-2">
          {interactions?.map((interaction: { id: string; occurredAt: string; note: string | null }) => (
            <div
              key={interaction.id}
              className="bg-gray-900 rounded-lg px-3 py-2 text-xs"
            >
              <div className="text-gray-400">
                {formatDate(new Date(interaction.occurredAt))}
              </div>
              {interaction.note && (
                <div className="text-gray-300 mt-0.5">{interaction.note}</div>
              )}
            </div>
          ))}
          {(!interactions || interactions.length === 0) && (
            <p className="text-xs text-gray-600">No interactions logged yet</p>
          )}
        </div>
      </div>

      {/* Delete */}
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={handleDelete}
          className="text-xs text-red-500 hover:text-red-400 transition-colors"
        >
          Remove from network
        </button>
      </div>
    </div>
  );
}
