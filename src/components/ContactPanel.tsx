"use client";

import { useState, useEffect } from "react";
import type { GraphNode } from "./graph/types";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import { RELATIONSHIP_LABELS } from "@/lib/constants";
import { useContactInteractions, useLogInteraction } from "@/hooks/useInteractions";
import { useDeleteContact, useUpdateContact, useGenerateBio } from "@/hooks/useContacts";
import { useGroups, useCreateGroup } from "@/hooks/useGroups";
import { useContactCalendarEvents, useConfirmMatch } from "@/hooks/useCalendar";
import type { ContactCalendarEvent } from "@/hooks/useCalendar";

interface ContactPanelProps {
  node: GraphNode;
  onClose: () => void;
  onInteractionLogged?: (nodeId: string) => void;
}

const SENTIMENTS = [
  { value: "great" as const, emoji: "\u2764\uFE0F", label: "Great" },
  { value: "good" as const, emoji: "\uD83D\uDC4D", label: "Good" },
  { value: "neutral" as const, emoji: "\uD83D\uDE10", label: "Neutral" },
  { value: "awkward" as const, emoji: "\uD83D\uDE2C", label: "Awkward" },
];

const RELATIONSHIP_KEYS = Object.keys(RELATIONSHIP_LABELS);

function formatTimeRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const dateStr = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const startTime = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endTime = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateStr}, ${startTime}\u2013${endTime}`;
}

function CalendarEventCard({
  event,
  isPast,
  confirmMatch,
}: {
  event: ContactCalendarEvent;
  isPast: boolean;
  confirmMatch: ReturnType<typeof useConfirmMatch>;
}) {
  const isUnconfirmed = !event.confirmed && !event.interactionCreated;
  const isConfirmed = event.confirmed || event.interactionCreated;

  return (
    <div className={`bg-[var(--bg-elevated)] rounded-xl px-3 py-2 text-xs ${isConfirmed && isPast ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[var(--text-primary)] font-medium truncate">
            {event.eventSummary || "Calendar event"}
          </div>
          <div className="text-[var(--text-muted)] mt-0.5">
            {formatTimeRange(event.eventStart, event.eventEnd)}
          </div>
        </div>
        {isConfirmed && isPast && (
          <span className="text-[var(--success)] flex-shrink-0" title="Logged">{"\u2713"}</span>
        )}
      </div>
      {/* Match method pill */}
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)]">
          {event.matchMethod === "email_exact" ? (
            <>{"\uD83D\uDCE7"} email match</>
          ) : event.matchMethod === "name_exact" ? (
            <>{"\uD83D\uDC64"} name match</>
          ) : event.matchMethod === "email_username" ? (
            <>{"\uD83D\uDCE7"} email pattern ({Math.round((event.matchConfidence ?? 0) * 100)}%)</>
          ) : event.matchMethod === "llm_name" ? (
            <>{"\uD83E\uDD16"} fuzzy match ({Math.round((event.matchConfidence ?? 0) * 100)}%)</>
          ) : event.matchMethod === "title_mention" ? (
            <>{"\uD83D\uDCDD"} title match ({Math.round((event.matchConfidence ?? 0) * 100)}%)</>
          ) : event.matchMethod === "manual" ? (
            <>{"\u270B"} manual</>
          ) : (
            <>matched</>
          )}
        </span>
      </div>
      {/* Confirm/dismiss for unconfirmed past events */}
      {isUnconfirmed && isPast && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Log this?</span>
          <button
            onClick={() => confirmMatch.mutate({ id: event.id, confirmed: true })}
            disabled={confirmMatch.isPending}
            className="text-[var(--success)] hover:brightness-110 transition-colors font-medium"
          >
            Yes
          </button>
          <button
            onClick={() => confirmMatch.mutate({ id: event.id, confirmed: false })}
            disabled={confirmMatch.isPending}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default function ContactPanel({ node, onClose, onInteractionLogged }: ContactPanelProps) {
  const [note, setNote] = useState("");
  const [sentiment, setSentiment] = useState<"great" | "good" | "neutral" | "awkward" | null>(null);
  const [occurredAt, setOccurredAt] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(node.email || "");

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);
  const [relationshipDraft, setRelationshipDraft] = useState(node.relationshipType);
  const [importanceDraft, setImportanceDraft] = useState(node.importance);
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(node.bio || "");

  // Reset drafts when node changes
  useEffect(() => {
    setNameDraft(node.name);
    setRelationshipDraft(node.relationshipType);
    setImportanceDraft(node.importance);
    setEmailDraft(node.email || "");
    setBioDraft(node.bio || "");
    setEditing(false);
    setEditingEmail(false);
    setEditingBio(false);
  }, [node.id, node.name, node.relationshipType, node.importance, node.email, node.bio]);

  const { data: interactions } = useContactInteractions(node.id);
  const logInteraction = useLogInteraction();
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();
  const generateBio = useGenerateBio();
  const { data: groups } = useGroups();
  const createGroup = useCreateGroup();
  const { data: calendarEvents } = useContactCalendarEvents(node.id);
  const confirmMatch = useConfirmMatch();

  const now = new Date();
  const upcomingEvents = calendarEvents?.filter((e) => new Date(e.eventStart) > now) ?? [];
  const pastEvents = calendarEvents?.filter((e) => new Date(e.eventStart) <= now).reverse() ?? [];

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

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== node.name) {
      updateContact.mutate({ id: node.id, name: trimmed });
    }
  };

  const saveRelationship = (value: string) => {
    setRelationshipDraft(value);
    if (value !== node.relationshipType) {
      updateContact.mutate({ id: node.id, relationshipType: value });
    }
  };

  const saveImportance = (value: number) => {
    setImportanceDraft(value);
    if (value !== node.importance) {
      updateContact.mutate({ id: node.id, importance: value });
    }
  };

  const tempPercent = Math.round(node.temperature * 100);

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-[var(--bg-card)]/95 border-l border-[var(--border-subtle)] backdrop-blur-sm z-40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 mr-2">
            {/* Name — editable in edit mode */}
            {editing ? (
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="text-lg font-semibold text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2 py-0.5 w-full focus:outline-none focus:border-[var(--amber)]"
                autoFocus
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") { setNameDraft(node.name); setEditing(false); }
                }}
              />
            ) : (
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{node.name}</h2>
            )}

            {/* Relationship type — editable in edit mode */}
            {editing ? (
              <select
                value={relationshipDraft}
                onChange={(e) => saveRelationship(e.target.value)}
                className="mt-1 text-sm text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2 py-0.5 focus:outline-none focus:border-[var(--amber)] [color-scheme:dark]"
              >
                {RELATIONSHIP_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {RELATIONSHIP_LABELS[key]}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                {RELATIONSHIP_LABELS[node.relationshipType] || node.relationshipType}
              </p>
            )}

            {/* Editable email */}
            {!editingEmail ? (
              <button
                onClick={() => {
                  setEmailDraft(node.email || "");
                  setEditingEmail(true);
                }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mt-0.5"
              >
                {node.email || "+ Add email"}
              </button>
            ) : (
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="email@example.com"
                className="mt-0.5 w-full bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2 py-0.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                autoFocus
                onBlur={() => {
                  const trimmed = emailDraft.trim();
                  if (trimmed !== (node.email || "")) {
                    updateContact.mutate({ id: node.id, email: trimmed || undefined });
                  }
                  setEditingEmail(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") {
                    setEmailDraft(node.email || "");
                    setEditingEmail(false);
                  }
                }}
              />
            )}

            {/* Bio */}
            {!editingBio ? (
              <div className="flex items-start gap-1 mt-1">
                <button
                  onClick={() => {
                    setBioDraft(node.bio || "");
                    setEditingBio(true);
                  }}
                  className={`text-xs transition-colors text-left leading-relaxed flex-1 ${
                    node.bio
                      ? "text-[var(--text-secondary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {node.bio || "+ Add bio"}
                </button>
                <button
                  onClick={() => {
                    generateBio.mutate(node.id, {
                      onSuccess: (data) => {
                        if (data.bio) {
                          setBioDraft(data.bio);
                        }
                      },
                    });
                  }}
                  disabled={generateBio.isPending}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors flex-shrink-0 mt-0.5"
                  title="Generate bio from journal context"
                >
                  {generateBio.isPending ? "..." : "\u2728"}
                </button>
              </div>
            ) : (
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                placeholder="Who is this person to you? e.g. College roommate, works at Stripe, met at YC..."
                className="mt-1 w-full bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] resize-none leading-relaxed"
                rows={2}
                autoFocus
                onBlur={() => {
                  const trimmed = bioDraft.trim();
                  if (trimmed !== (node.bio || "")) {
                    updateContact.mutate({ id: node.id, bio: trimmed || null });
                  }
                  setEditingBio(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                  }
                  if (e.key === "Escape") {
                    setBioDraft(node.bio || "");
                    setEditingBio(false);
                  }
                }}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Edit toggle */}
            <button
              onClick={() => setEditing(!editing)}
              className={`transition-colors text-sm leading-none p-1 rounded-lg ${
                editing
                  ? "text-[var(--amber)] bg-[var(--amber-ghost-bg)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              title={editing ? "Done editing" : "Edit contact"}
            >
              {editing ? "\u2713" : "\u270E"}
            </button>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Group badges/selector */}
        <div className="mt-2 relative">
          <div className="flex flex-wrap gap-1 items-center">
            {node.groupIds.length > 0 && groups?.filter((g) => node.groupIds.includes(g.id)).map((g) => (
              <span
                key={g.id}
                className="text-xs px-2 py-0.5 rounded-full border"
                style={g.color ? {
                  borderColor: g.color + "66",
                  color: g.color,
                  backgroundColor: g.color + "15",
                } : { borderColor: "var(--border-medium)", color: "var(--text-secondary)" }}
              >
                {g.name}
              </span>
            ))}
            <button
              onClick={() => setShowGroupMenu(!showGroupMenu)}
              className="text-xs px-2 py-0.5 rounded-full transition-colors border border-[var(--border-medium)] hover:border-[var(--amber)] text-[var(--text-muted)] hover:text-[var(--amber)]"
            >
              {node.groupIds.length > 0 ? "Edit" : "+ Add to group"}
            </button>
          </div>
          {showGroupMenu && (
            <div className="absolute top-7 left-0 z-10 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-xl shadow-xl py-1 min-w-[180px]">
              {groups?.map((g) => {
                const isMember = node.groupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => {
                      const newGroupIds = isMember
                        ? node.groupIds.filter((id) => id !== g.id)
                        : [...node.groupIds, g.id];
                      updateContact.mutate({ id: node.id, groupIds: newGroupIds });
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-card)] transition-colors flex items-center gap-2 text-[var(--text-secondary)]"
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isMember ? "bg-[var(--amber)] border-[var(--amber)]" : "border-[var(--border-medium)]"
                    }`}>
                      {isMember && (
                        <svg className="w-2.5 h-2.5 text-[var(--bg-base)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    {g.color && (
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                    )}
                    {g.name}
                  </button>
                );
              })}
              <div className="border-t border-[var(--border-subtle)] mt-1 pt-1">
                {!creatingGroup ? (
                  <button
                    onClick={() => setCreatingGroup(true)}
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card)] transition-colors"
                  >
                    {"\uFF0B"} New group...
                  </button>
                ) : (
                  <div className="px-3 py-1.5 flex gap-1">
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Group name"
                      className="flex-1 bg-[var(--bg-card)] border border-[var(--border-medium)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newGroupName.trim()) {
                          createGroup.mutate(
                            { name: newGroupName.trim() },
                            {
                              onSuccess: (newGroup) => {
                                updateContact.mutate({ id: node.id, groupIds: [...node.groupIds, newGroup.id] });
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
                                updateContact.mutate({ id: node.id, groupIds: [...node.groupIds, newGroup.id] });
                                setNewGroupName("");
                                setCreatingGroup(false);
                                setShowGroupMenu(false);
                              },
                            }
                          );
                        }
                      }}
                      className="text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] px-1"
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
            <span className="text-[var(--text-secondary)]">Temperature</span>
            <span
              className="font-medium"
              style={{ color: node.color }}
            >
              {temperatureLabel(node.temperature)} ({tempPercent}%)
            </span>
          </div>
          <div className="h-2 bg-[var(--border-medium)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${tempPercent}%`,
                backgroundColor: node.color,
              }}
            />
          </div>
        </div>

        {/* Stats — importance is editable in edit mode */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-[var(--bg-elevated)] rounded-xl px-3 py-2">
            <div className="text-[var(--text-muted)]">Importance</div>
            {editing ? (
              <div className="flex items-center gap-2 mt-0.5">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={importanceDraft}
                  onChange={(e) => saveImportance(Number(e.target.value))}
                  className="flex-1 h-1 accent-[var(--amber)] cursor-pointer"
                />
                <span className="text-[var(--text-primary)] font-medium w-5 text-right">{importanceDraft}</span>
              </div>
            ) : (
              <div className="text-[var(--text-primary)] font-medium">{node.importance}/10</div>
            )}
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-xl px-3 py-2">
            <div className="text-[var(--text-muted)]">Last Contact</div>
            <div className="text-[var(--text-primary)] font-medium">
              {node.lastInteraction
                ? formatDate(new Date(node.lastInteraction))
                : "Never"}
            </div>
          </div>
        </div>
      </div>

      {/* Log Interaction */}
      <div className="p-5 border-b border-[var(--border-subtle)]">
        <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
          Log Interaction
        </h3>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 200) + "px";
          }}
          placeholder="What did you talk about? Topics, key takeaways, follow-ups..."
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] resize-y min-h-[60px] max-h-[200px]"
          rows={3}
        />
        <div className="mt-2 flex items-center gap-1">
          <span className="text-xs text-[var(--text-muted)] mr-1">Vibe:</span>
          {SENTIMENTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSentiment(sentiment === s.value ? null : s.value)}
              title={s.label}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all ${
                sentiment === s.value
                  ? "bg-[var(--amber-ghost-bg)] ring-1 ring-[var(--amber)] scale-110"
                  : "bg-[var(--bg-elevated)] hover:bg-[var(--bg-card)] opacity-60 hover:opacity-100"
              }`}
            >
              {s.emoji}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">When:</span>
          {!showDatePicker ? (
            <button
              onClick={() => setShowDatePicker(true)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors bg-[var(--bg-elevated)] hover:bg-[var(--bg-card)] px-2 py-1 rounded-lg"
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
                className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--amber)] [color-scheme:dark]"
              />
              <button
                onClick={() => {
                  setOccurredAt("");
                  setShowDatePicker(false);
                }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors px-1"
                title="Reset to today"
              >
                {"\u2715"}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleLogInteraction}
          disabled={logInteraction.isPending}
          className="mt-3 w-full bg-[var(--amber)] hover:bg-[var(--amber-hover)] disabled:opacity-50 text-[var(--bg-base)] text-sm font-medium py-2.5 rounded-xl transition-colors"
        >
          {logInteraction.isPending ? "Logging..." : "I talked to them"}
        </button>
      </div>

      {/* Scrollable content area: Calendar + History */}
      <div className="flex-1 overflow-y-auto">
        {/* Calendar Timeline */}
        {calendarEvents && calendarEvents.length > 0 && (
          <div className="p-5 border-b border-[var(--border-subtle)]">
            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
              <span>{"\uD83D\uDCC5"} Calendar</span>
              <span className="bg-[var(--bg-elevated)] text-[var(--text-muted)] text-[10px] px-1.5 py-0.5 rounded-full font-normal">
                {calendarEvents.length}
              </span>
            </h3>
            <div className="space-y-3">
              {/* Upcoming events */}
              {upcomingEvents.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Upcoming</div>
                  <div className="space-y-1.5">
                    {upcomingEvents.map((event) => (
                      <CalendarEventCard key={event.id} event={event} isPast={false} confirmMatch={confirmMatch} />
                    ))}
                  </div>
                </div>
              )}
              {/* Past events */}
              {pastEvents.length > 0 && (
                <div>
                  {upcomingEvents.length > 0 && <div className="border-t border-[var(--border-subtle)] my-2" />}
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Past</div>
                  <div className="space-y-1.5">
                    {pastEvents.map((event) => (
                      <CalendarEventCard key={event.id} event={event} isPast={true} confirmMatch={confirmMatch} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Interaction History */}
        <div className="p-5">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
            History ({node.interactionCount})
          </h3>
          <div className="space-y-2">
            {interactions?.map((interaction: { id: string; occurredAt: string; note: string | null; sentiment: string | null; source: string | null }) => (
              <div
                key={interaction.id}
                className="bg-[var(--bg-elevated)] rounded-xl px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    {(interaction.source === "calendar_auto" || interaction.source === "calendar_confirmed") && (
                      <span title="From calendar">{"\uD83D\uDCC5"}</span>
                    )}
                    {interaction.source === "journal" && (
                      <span title="From journal">{"\uD83D\uDCD3"}</span>
                    )}
                    {formatDate(new Date(interaction.occurredAt))}
                  </span>
                  {interaction.sentiment && (
                    <span className="text-sm" title={interaction.sentiment}>
                      {SENTIMENTS.find((s) => s.value === interaction.sentiment)?.emoji}
                    </span>
                  )}
                </div>
                {interaction.note && (
                  <div className="text-[var(--text-secondary)] mt-0.5">{interaction.note}</div>
                )}
              </div>
            ))}
            {(!interactions || interactions.length === 0) && (
              <p className="text-xs text-[var(--text-muted)]">No interactions logged yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Delete */}
      <div className="p-5 border-t border-[var(--border-subtle)]">
        <button
          onClick={handleDelete}
          className="text-xs text-[var(--danger)] hover:brightness-110 transition-colors"
        >
          Remove from network
        </button>
      </div>
    </div>
  );
}
