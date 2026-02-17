"use client";

import { useState, useCallback } from "react";
import { useDailyBriefing } from "@/hooks/useBriefing";
import { useJournalOpenLoops, useResolveOpenLoop, useSnoozeOpenLoop } from "@/hooks/useJournal";
import { useDailySuggestions } from "@/hooks/useSuggestions";
import { useLogInteraction } from "@/hooks/useInteractions";
import type { DailyBriefingContent } from "@/lib/briefing";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const PINGED_KEY_PREFIX = "icyhot-daily-pinged-";

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

export default function BriefingView() {
  const { data, isLoading } = useDailyBriefing();
  const { data: loops } = useJournalOpenLoops();
  const resolveLoop = useResolveOpenLoop();
  const snoozeLoop = useSnoozeOpenLoop();
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);

  // Reach-out state
  const { data: suggestionsData } = useDailySuggestions();
  const logInteraction = useLogInteraction();
  const [pingedIds, setPingedIds] = useState<Set<string>>(loadPingedIds);
  const [expandedReachOutId, setExpandedReachOutId] = useState<string | null>(null);
  const [reachOutNote, setReachOutNote] = useState("");

  const handlePinged = useCallback(
    (contactId: string, note?: string) => {
      logInteraction.mutate(
        { contactId, note: note || undefined },
        {
          onSuccess: () => {
            const next = new Set(pingedIds);
            next.add(contactId);
            setPingedIds(next);
            savePingedIds(next);
            setExpandedReachOutId(null);
            setReachOutNote("");
          },
        }
      );
    },
    [logInteraction, pingedIds]
  );

  if (isLoading) {
    return (
      <div className="max-w-[640px] mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--bg-elevated)] rounded w-48" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded w-full" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded w-3/4" />
        </div>
      </div>
    );
  }

  const briefing = data?.briefing;
  const dateStr = data?.date || new Date().toISOString().slice(0, 10);
  const activeLoops = loops?.filter((l) => !l.resolved) ?? [];
  const suggestions = suggestionsData?.suggestions ?? [];
  const unpingedSuggestions = suggestions.filter((s) => !pingedIds.has(s.id));
  const allPinged = suggestions.length > 0 && unpingedSuggestions.length === 0;

  return (
    <div className="max-w-[640px] mx-auto p-6 space-y-8">
      {/* Date header */}
      <div>
        <h1 className="text-lg font-medium text-[var(--text-primary)] tracking-tight">
          {formatDate(dateStr)}
        </h1>
        {briefing?.summary && (
          <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            {briefing.summary}
          </p>
        )}
      </div>

      {/* Zen divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--amber)]/30 to-transparent" />

      {/* Today — Meeting Prep */}
      {briefing && briefing.todayContext.length > 0 && (
        <BriefingSection title="Today" icon="☀️">
          <div className="space-y-3">
            {briefing.todayContext.map((meeting, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-1 rounded-full bg-[var(--amber)]/40 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {meeting.contactName}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {meeting.eventTime}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                    {meeting.briefing}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Notice — Pattern Alerts + Relationship Arc */}
      {briefing && (briefing.patternAlerts.length > 0 || briefing.relationshipArc) && (
        <BriefingSection title="Notice" icon="🔮">
          <div className="space-y-3">
            {briefing.patternAlerts.map((alert, i) => (
              <div key={i} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {alert.pattern}
                </p>
                <span className="text-xs text-[var(--amber)] mt-1 inline-block">
                  Observed {alert.occurrences}× · {alert.trend}
                </span>
              </div>
            ))}
            {briefing.relationshipArc && (
              <div className="border-l-2 border-[var(--amber)]/40 bg-[var(--amber-ghost-bg)] rounded-r-xl px-4 py-3">
                <div className="text-xs font-medium text-[var(--amber)] mb-1">
                  {briefing.relationshipArc.contactName}
                </div>
                <p className="text-sm text-[var(--text-primary)] leading-relaxed italic">
                  {briefing.relationshipArc.arc}
                </p>
              </div>
            )}
          </div>
        </BriefingSection>
      )}

      {/* Unfinished — Open Loops */}
      {activeLoops.length > 0 && (
        <BriefingSection title="Unfinished" icon="📌">
          <div className="space-y-2">
            {activeLoops.slice(0, 5).map((loop) => (
              <div key={loop.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {loop.content}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span>{loop.entryDate}</span>
                    {loop.contactName && (
                      <span className="bg-[var(--bg-card)] px-2 py-0.5 rounded-lg">
                        {loop.contactName}
                      </span>
                    )}
                  </div>
                  {snoozeOpenId === loop.id ? (
                    <div className="flex items-center gap-1.5">
                      {[
                        { label: "Tomorrow", days: 1 },
                        { label: "Next week", days: 7 },
                      ].map((opt) => (
                        <button
                          key={opt.days}
                          onClick={() => {
                            snoozeLoop.mutate({ id: loop.id, snoozedUntil: addDays(opt.days) });
                            setSnoozeOpenId(null);
                          }}
                          className="text-[11px] bg-[var(--amber-ghost-bg)] hover:bg-[var(--amber)]/20 text-[var(--amber)] px-2 py-0.5 rounded-md transition-colors"
                        >
                          {opt.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setSnoozeOpenId(null)}
                        className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-1"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setSnoozeOpenId(loop.id)}
                        className="text-xs bg-[var(--bg-card)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] font-medium px-2.5 py-1 rounded-lg transition-colors"
                      >
                        Later
                      </button>
                      <button
                        onClick={() => resolveLoop.mutate({ id: loop.id, resolved: true })}
                        className="text-xs bg-[var(--success)]/15 hover:bg-[var(--success)]/25 text-[var(--success)] font-medium px-2.5 py-1 rounded-lg transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Temperature Alerts */}
      {briefing && briefing.temperatureAlerts.length > 0 && (
        <BriefingSection title="Drifting" icon="🌊">
          <div className="space-y-2">
            {briefing.temperatureAlerts.map((alert, i) => (
              <div key={i} className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-[var(--danger)]/60 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {alert.contactName}
                  </span>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {alert.suggestion}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Reach Out */}
      {suggestions.length > 0 && (
        <BriefingSection title={allPinged ? "All Reached Out" : "Reach Out"} icon="👋">
          {allPinged ? (
            <div className="bg-[var(--success)]/10 rounded-xl px-4 py-3 text-center">
              <p className="text-sm text-[var(--success)]">
                You&apos;ve reached out to everyone today. Nice work.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => {
                const isPinged = pingedIds.has(s.id);
                const isExpanded = expandedReachOutId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`bg-[var(--bg-elevated)] rounded-xl px-4 py-3 ${isPinged ? "opacity-50" : ""}`}
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
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                            {s.blurb}
                          </p>
                        )}
                      </div>
                      {!isPinged && !isExpanded && (
                        <button
                          onClick={() => { setExpandedReachOutId(s.id); setReachOutNote(""); }}
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
                          value={reachOutNote}
                          onChange={(e) => setReachOutNote(e.target.value)}
                          placeholder="What about? (optional)"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handlePinged(s.id, reachOutNote);
                            if (e.key === "Escape") { setExpandedReachOutId(null); setReachOutNote(""); }
                          }}
                          className="flex-1 bg-[var(--bg-card)] border border-[var(--border-medium)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                        />
                        <button
                          onClick={() => handlePinged(s.id, reachOutNote)}
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
        </BriefingSection>
      )}

      {/* Empty state */}
      {!briefing && (
        <div className="text-center py-12">
          <p className="text-sm text-[var(--text-muted)]">
            Your daily briefing will appear here once your journal and calendar are synced.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Section Component ─────────────────────────────────────────────────

function BriefingSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{icon}</span>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
