"use client";

import { useState } from "react";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import { useJournalOpenLoops, useResolveOpenLoop, useSnoozeOpenLoop } from "@/hooks/useJournal";

function formatSnoozeDate(date: Date): string {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatSnoozeDate(d);
}

const SNOOZE_OPTIONS = [
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
  { label: "Next month", days: 30 },
] as const;

export default function OpenLoopsCard() {
  const { data: loops, isLoading } = useJournalOpenLoops();
  const resolveLoop = useResolveOpenLoop();
  const snoozeLoop = useSnoozeOpenLoop();
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);

  if (isLoading) return null;
  if (!loops?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle icon="📌">Open Loops</CardTitle>
        <span className="text-xs text-[var(--text-muted)]">{loops.length} open</span>
      </CardHeader>
      <div className="space-y-2.5">
        {loops.map((loop) => (
          <div key={loop.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
            <div className="text-sm text-[var(--text-primary)] leading-relaxed">
              {loop.content}
            </div>
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
                /* Snooze picker */
                <div className="flex items-center gap-1.5">
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.days}
                      onClick={() => {
                        snoozeLoop.mutate({ id: loop.id, snoozedUntil: addDays(opt.days) });
                        setSnoozeOpenId(null);
                      }}
                      disabled={snoozeLoop.isPending}
                      className="text-[11px] bg-[var(--amber-ghost-bg)] hover:bg-[var(--amber)]/20 text-[var(--amber)] px-2 py-0.5 rounded-md transition-colors disabled:opacity-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setSnoozeOpenId(null)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-1 transition-colors"
                  >
                    &times;
                  </button>
                </div>
              ) : (
                /* Default buttons */
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSnoozeOpenId(loop.id)}
                    className="text-xs bg-[var(--bg-card)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] font-medium px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Later
                  </button>
                  <button
                    onClick={() => resolveLoop.mutate({ id: loop.id, resolved: true })}
                    disabled={resolveLoop.isPending}
                    className="text-xs bg-[var(--success)]/15 hover:bg-[var(--success)]/25 text-[var(--success)] font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Resolve
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
