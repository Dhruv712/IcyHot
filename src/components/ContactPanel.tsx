"use client";

import { useState } from "react";
import type { GraphNode } from "./graph/types";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import { RELATIONSHIP_LABELS } from "@/lib/constants";
import { useContactInteractions, useLogInteraction } from "@/hooks/useInteractions";
import { useDeleteContact, useUpdateContact } from "@/hooks/useContacts";
import { useGroups, useCreateGroup } from "@/hooks/useGroups";

interface ContactPanelProps {
  node: GraphNode;
  onClose: () => void;
  onInteractionLogged?: (nodeId: string) => void;
}

const SENTIMENTS = [
  { value: "great" as const, emoji: "❤️", label: "Great" },
  { value: "good" as const, emoji: "👍", label: "Good" },
  { value: "neutral" as const, emoji: "😐", label: "Neutral" },
  { value: "awkward" as const, emoji: "😬", label: "Awkward" },
];

export default function ContactPanel({ node, onClose, onInteractionLogged }: ContactPanelProps) {
  const [note, setNote] = useState("");
  const [sentiment, setSentiment] = useState<"great" | "good" | "neutral" | "awkward" | null>(null);
  const [occurredAt, setOccurredAt] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const { data: interactions } = useContactInteractions(node.id);
  const logInteraction = useLogInteraction();
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();
  const { data: groups } = useGroups();
  const createGroup = useCreateGroup();

  const handleLogInteraction = () => {
    logInteraction.mutate(
      {
        contactId: node.id,
        note: note || undefined,
        sentiment: sentiment || undefined,
        occurredAt: occurredAt || undefined,
      },
      {
        onSuccess: () => {
          setNote("");
          setSentiment(null);
          setOccurredAt("");
          setShowDatePicker(false);
          onInteractionLogged?.(node.id);
        },
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

        {/* Group badge/selector */}
        <div className="mt-2 relative">
          {(() => {
            const currentGroup = groups?.find((g) => g.id === node.groupId);
            return (
              <button
                onClick={() => setShowGroupMenu(!showGroupMenu)}
                className="text-xs px-2 py-0.5 rounded-full transition-colors border border-gray-700 hover:border-gray-500"
                style={currentGroup?.color ? {
                  borderColor: currentGroup.color + "66",
                  color: currentGroup.color,
                  backgroundColor: currentGroup.color + "15",
                } : undefined}
              >
                {currentGroup ? currentGroup.name : "+ Add to group"}
              </button>
            );
          })()}
          {showGroupMenu && (
            <div className="absolute top-7 left-0 z-10 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]">
              {node.groupId && (
                <button
                  onClick={() => {
                    updateContact.mutate({ id: node.id, groupId: null });
                    setShowGroupMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 transition-colors"
                >
                  Remove from group
                </button>
              )}
              {groups?.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    updateContact.mutate({ id: node.id, groupId: g.id });
                    setShowGroupMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 transition-colors flex items-center gap-2 ${
                    g.id === node.groupId ? "text-white font-medium" : "text-gray-300"
                  }`}
                >
                  {g.color && (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                  )}
                  {g.name}
                  {g.id === node.groupId && <span className="text-gray-500 ml-auto">current</span>}
                </button>
              ))}
              <div className="border-t border-gray-700 mt-1 pt-1">
                {!creatingGroup ? (
                  <button
                    onClick={() => setCreatingGroup(true)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 transition-colors"
                  >
                    ＋ New group...
                  </button>
                ) : (
                  <div className="px-3 py-1.5 flex gap-1">
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Group name"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newGroupName.trim()) {
                          createGroup.mutate(
                            { name: newGroupName.trim() },
                            {
                              onSuccess: (newGroup) => {
                                updateContact.mutate({ id: node.id, groupId: newGroup.id });
                                setNewGroupName("");
                                setCreatingGroup(false);
                                setShowGroupMenu(false);
                              },
                            }
                          );
                        }
                        if (e.key === "Escape") {
                          setCreatingGroup(false);
                          setNewGroupName("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newGroupName.trim()) {
                          createGroup.mutate(
                            { name: newGroupName.trim() },
                            {
                              onSuccess: (newGroup) => {
                                updateContact.mutate({ id: node.id, groupId: newGroup.id });
                                setNewGroupName("");
                                setCreatingGroup(false);
                                setShowGroupMenu(false);
                              },
                            }
                          );
                        }
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 px-1"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
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
          onChange={(e) => {
            setNote(e.target.value);
            // Auto-expand textarea to fit content
            const el = e.target;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 200) + "px";
          }}
          placeholder="What did you talk about? Topics, key takeaways, follow-ups..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-y min-h-[60px] max-h-[200px]"
          rows={3}
        />
        <div className="mt-2 flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Vibe:</span>
          {SENTIMENTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSentiment(sentiment === s.value ? null : s.value)}
              title={s.label}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all ${
                sentiment === s.value
                  ? "bg-gray-700 ring-1 ring-gray-500 scale-110"
                  : "bg-gray-900 hover:bg-gray-800 opacity-60 hover:opacity-100"
              }`}
            >
              {s.emoji}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-500">When:</span>
          {!showDatePicker ? (
            <button
              onClick={() => setShowDatePicker(true)}
              className="text-xs text-gray-400 hover:text-white transition-colors bg-gray-900 hover:bg-gray-800 px-2 py-1 rounded"
            >
              {occurredAt
                ? new Date(occurredAt + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : "Today"}
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
                onClick={() => {
                  setOccurredAt("");
                  setShowDatePicker(false);
                }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-1"
                title="Reset to today"
              >
                ✕
              </button>
            </div>
          )}
        </div>
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
          {interactions?.map((interaction: { id: string; occurredAt: string; note: string | null; sentiment: string | null }) => (
            <div
              key={interaction.id}
              className="bg-gray-900 rounded-lg px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between text-gray-400">
                <span>{formatDate(new Date(interaction.occurredAt))}</span>
                {interaction.sentiment && (
                  <span className="text-sm" title={interaction.sentiment}>
                    {SENTIMENTS.find((s) => s.value === interaction.sentiment)?.emoji}
                  </span>
                )}
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
