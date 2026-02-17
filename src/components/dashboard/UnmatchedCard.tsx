"use client";

import { useState } from "react";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import { useUnmatchedEvents, useManualMatch, useSkipEvent } from "@/hooks/useCalendar";
import { useCreateContact } from "@/hooks/useContacts";

interface UnmatchedCardProps {
  calendarConnected: boolean;
  contacts: { id: string; name: string }[];
}

export default function UnmatchedCard({ calendarConnected, contacts }: UnmatchedCardProps) {
  const { data: events } = useUnmatchedEvents(calendarConnected);
  const manualMatch = useManualMatch();
  const skipEvent = useSkipEvent();
  const createContact = useCreateContact();
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  if (!events?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle icon="📅">Unmatched Events</CardTitle>
        <span className="text-xs text-[var(--text-muted)]">{events.length} to review</span>
      </CardHeader>
      <div className="space-y-3">
        {events.slice(0, 5).map((event) => {
          const search = searchTerms[event.id] || "";
          const filtered = search
            ? contacts.filter((c) =>
                c.name.toLowerCase().includes(search.toLowerCase())
              )
            : [];
          const attendeeNames: string[] = event.attendeeNames
            ? JSON.parse(event.attendeeNames)
            : [];
          const showCreateOption = search.trim().length > 0 && filtered.length === 0;
          const isCreating = creatingFor === event.id;

          return (
            <div key={event.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
              <div className="text-sm text-[var(--text-primary)] font-medium truncate">
                {event.summary || "Calendar event"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                {new Date(event.startTime).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                {attendeeNames.length > 0 && (
                  <span> · {attendeeNames.join(", ")}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) =>
                      setSearchTerms((prev) => ({ ...prev, [event.id]: e.target.value }))
                    }
                    placeholder="Match to..."
                    className="w-full bg-[var(--bg-card)] border border-[var(--border-medium)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                  />
                  {search && (filtered.length > 0 || showCreateOption) && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg shadow-lg max-h-40 overflow-y-auto z-10">
                      {filtered.slice(0, 5).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            manualMatch.mutate({ eventId: event.id, contactId: c.id });
                            setSearchTerms((prev) => ({ ...prev, [event.id]: "" }));
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                        >
                          {c.name}
                        </button>
                      ))}
                      {showCreateOption && (
                        <button
                          onClick={() => {
                            setCreatingFor(event.id);
                            createContact.mutate(
                              { name: search.trim() },
                              {
                                onSuccess: (newContact) => {
                                  manualMatch.mutate({ eventId: event.id, contactId: newContact.id });
                                  setSearchTerms((prev) => ({ ...prev, [event.id]: "" }));
                                  setCreatingFor(null);
                                },
                                onError: () => setCreatingFor(null),
                              }
                            );
                          }}
                          disabled={isCreating}
                          className="w-full text-left px-3 py-1.5 text-xs text-[var(--amber)] hover:bg-[var(--bg-elevated)] transition-colors border-t border-[var(--border-subtle)] flex items-center gap-1.5"
                        >
                          <span className="text-[10px]">+</span>
                          {isCreating ? "Creating..." : `Create "${search.trim()}" & match`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => skipEvent.mutate(event.id)}
                  disabled={skipEvent.isPending}
                  className="text-xs bg-[var(--bg-card)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Skip
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
