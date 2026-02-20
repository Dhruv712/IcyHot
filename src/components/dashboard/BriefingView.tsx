"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDailyBriefing } from "@/hooks/useBriefing";
import { useJournalOpenLoops, useResolveOpenLoop, useSnoozeOpenLoop } from "@/hooks/useJournal";
import { useDailySuggestions } from "@/hooks/useSuggestions";
import { useHabits } from "@/hooks/useHabits";
import { useLogInteraction } from "@/hooks/useInteractions";
import { useDismissProvocation } from "@/hooks/useProvocations";
import BriefingSection from "./BriefingSection";
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
  const dismissProvocation = useDismissProvocation();
  const [expandedProvId, setExpandedProvId] = useState<string | null>(null);

  // Habits
  const { data: habitsData } = useHabits();
  const router = useRouter();

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

      {/* Provocations — Your patterns are talking */}
      {briefing?.provocations && briefing.provocations.length > 0 && (
        <BriefingSection title="Your patterns are talking" icon="🪞">
          <div className="space-y-3">
            {briefing.provocations.map((prov) => (
              <div
                key={prov.id}
                className="border-l-2 border-[var(--amber)]/50 bg-[var(--bg-elevated)] rounded-r-xl px-4 py-3"
              >
                {/* Trigger */}
                <div className="text-xs text-[var(--text-muted)] mb-1.5">
                  You said: &ldquo;{prov.triggerContent}&rdquo;
                </div>

                {/* Provocation text */}
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {prov.provocation}
                </p>

                {/* Actions row */}
                <div className="mt-2 flex items-center justify-between">
                  {/* See evidence toggle */}
                  {prov.supportingMemoryContents.length > 0 && (
                    <button
                      onClick={() =>
                        setExpandedProvId(
                          expandedProvId === prov.id ? null : prov.id
                        )
                      }
                      className="text-[11px] text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors"
                    >
                      {expandedProvId === prov.id
                        ? "Hide evidence"
                        : "See evidence"}
                    </button>
                  )}

                  {/* Dismiss button */}
                  <button
                    onClick={() => dismissProvocation.mutate(prov.id)}
                    disabled={dismissProvocation.isPending}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
                  >
                    &times;
                  </button>
                </div>

                {/* Expandable evidence */}
                {expandedProvId === prov.id && (
                  <div className="mt-2 space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
                    {prov.supportingMemoryContents.map(
                      (content: string, i: number) => (
                        <div
                          key={i}
                          className="text-xs text-[var(--text-secondary)] leading-relaxed italic"
                        >
                          &ldquo;{content}&rdquo;
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
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

      {/* Habits */}
      {habitsData &&
        (habitsData.contactStreaks.length > 0 || habitsData.behavioralHabits.length > 0) && (
        <BriefingSection title="Habits" icon="🔁">
          <HabitsContent
            contactStreaks={habitsData.contactStreaks}
            behavioralHabits={habitsData.behavioralHabits}
            onContactClick={(contactId) => router.push(`/?select=${contactId}`)}
          />
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

// ── Habits sub-component ──────────────────────────────────────────────

interface ContactStreakHabit {
  contactId: string;
  name: string;
  weeks: number;
  thisWeekDone: boolean;
}

interface BehavioralHabit {
  id: string;
  content: string;
  reinforcementCount: number;
  lastReinforcedAt: string;
  daysSinceReinforced: number;
  active: boolean;
}

function HabitsContent({
  contactStreaks,
  behavioralHabits,
  onContactClick,
}: {
  contactStreaks: ContactStreakHabit[];
  behavioralHabits: BehavioralHabit[];
  onContactClick: (contactId: string) => void;
}) {
  const hasBoth = contactStreaks.length > 0 && behavioralHabits.length > 0;
  const dayOfWeek = new Date().getDay(); // 0=Sun, 4=Thu
  const isLateInWeek = dayOfWeek >= 4 || dayOfWeek === 0; // Thu, Fri, Sat, Sun

  return (
    <div className="space-y-4">
      {/* Contact streaks */}
      {contactStreaks.length > 0 && (
        <div>
          {hasBoth && (
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2">
              People
            </div>
          )}
          <div className="space-y-1.5">
            {contactStreaks.map((streak) => {
              const atRisk = !streak.thisWeekDone && isLateInWeek;
              return (
                <button
                  key={streak.contactId}
                  onClick={() => onContactClick(streak.contactId)}
                  className={`w-full flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl px-4 py-2.5 transition-colors hover:bg-[var(--border-subtle)] text-left ${
                    atRisk ? "ring-1 ring-[var(--amber)]/30" : ""
                  }`}
                >
                  {/* Check / circle */}
                  {streak.thisWeekDone ? (
                    <div className="w-4 h-4 rounded-full bg-[var(--success)]/20 flex items-center justify-center flex-shrink-0">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5.5L4 7.5L8 3" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : (
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      atRisk ? "border-[var(--amber)]/60" : "border-[var(--text-muted)]/40"
                    }`} />
                  )}

                  {/* Name */}
                  <span className="text-sm text-[var(--text-primary)] flex-1 min-w-0 truncate">
                    {streak.name}
                  </span>

                  {/* Progress bar */}
                  <div className="w-12 h-1.5 bg-[var(--border-medium)] rounded-full overflow-hidden flex-shrink-0">
                    <div
                      className="h-full rounded-full bg-[var(--amber)]"
                      style={{ width: `${Math.min(streak.weeks / 8, 1) * 100}%` }}
                    />
                  </div>

                  {/* Badge */}
                  <span className="text-[11px] bg-[var(--amber-ghost-bg)] text-[var(--amber)] px-2 py-0.5 rounded-md flex-shrink-0">
                    {streak.weeks}w
                  </span>

                  {/* At-risk indicator */}
                  {atRisk && (
                    <span className="text-[10px] text-[var(--amber)] flex-shrink-0">⚠</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Behavioral habits */}
      {behavioralHabits.length > 0 && (
        <div>
          {hasBoth && (
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2">
              Personal
            </div>
          )}
          <div className="space-y-1.5">
            {behavioralHabits.map((habit) => (
              <div
                key={habit.id}
                className={`flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl px-4 py-2.5 ${
                  !habit.active ? "opacity-50" : ""
                }`}
              >
                {/* Active dot */}
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    habit.active ? "bg-[var(--success)]" : "bg-[var(--text-muted)]/40"
                  }`}
                />

                {/* Description */}
                <span className="text-sm text-[var(--text-primary)] flex-1 min-w-0 truncate">
                  {habit.content}
                </span>

                {/* Reinforcement count */}
                <span className="text-[11px] text-[var(--text-muted)] flex-shrink-0">
                  ×{habit.reinforcementCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

