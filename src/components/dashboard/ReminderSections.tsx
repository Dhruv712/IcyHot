"use client";

import {
  useCompleteJournalReminder,
  useDismissJournalReminder,
  useJournalReminders,
  useSnoozeJournalReminder,
} from "@/hooks/useJournal";

function formatDueDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function plusDays(days: number): string {
  const next = new Date();
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

function ReminderCard({
  reminder,
  urgent,
  onDone,
  onDismiss,
  onSnooze,
}: {
  reminder: {
    id: string;
    title: string;
    body: string | null;
    entryDate: string;
    contactName: string | null;
    dueAt: string;
    repeatRule: "none" | "daily" | "weekly" | "monthly";
  };
  urgent: boolean;
  onDone: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, dueAt: string) => void;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${
        urgent
          ? "border-[var(--amber)]/30 bg-[var(--amber-ghost-bg)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-card)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">{reminder.title}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Due {formatDueDate(reminder.dueAt)}
            {reminder.repeatRule !== "none" ? ` · repeats ${reminder.repeatRule}` : ""}
          </p>
          {reminder.contactName && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Linked to {reminder.contactName}
            </p>
          )}
          {reminder.body && (
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              {reminder.body}
            </p>
          )}
        </div>

        <a
          href={`/journal?date=${reminder.entryDate}`}
          className="text-[11px] uppercase tracking-[0.14em] text-[var(--amber)] transition-colors hover:text-[var(--amber-hover)]"
        >
          Open
        </a>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDone(reminder.id)}
          className="rounded-full border border-[var(--amber)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--amber)] transition-colors hover:bg-[var(--amber-ghost-bg)]"
        >
          Done
        </button>
        <button
          type="button"
          onClick={() => onSnooze(reminder.id, plusDays(1))}
          className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() => onSnooze(reminder.id, plusDays(7))}
          className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
        >
          Next week
        </button>
        <button
          type="button"
          onClick={() => onDismiss(reminder.id)}
          className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ReminderGroup({
  title,
  reminders,
  empty,
  urgent,
  onDone,
  onDismiss,
  onSnooze,
}: {
  title: string;
  reminders: Array<{
    id: string;
    title: string;
    body: string | null;
    entryDate: string;
    contactName: string | null;
    dueAt: string;
    repeatRule: "none" | "daily" | "weekly" | "monthly";
  }>;
  empty: string;
  urgent: boolean;
  onDone: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, dueAt: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)]">{title}</h2>
      </div>

      {reminders.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{empty}</p>
      ) : (
        <div className="space-y-3">
          {reminders.map((reminder) => (
            <ReminderCard
              key={reminder.id}
              reminder={reminder}
              urgent={urgent}
              onDone={onDone}
              onDismiss={onDismiss}
              onSnooze={onSnooze}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function ReminderSections() {
  const { data, isLoading } = useJournalReminders();
  const completeReminder = useCompleteJournalReminder();
  const dismissReminder = useDismissJournalReminder();
  const snoozeReminder = useSnoozeJournalReminder();

  if (isLoading) {
    return (
      <div className="max-w-[720px] mx-auto px-6 pb-24 space-y-8">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-40 rounded bg-[var(--bg-elevated)]" />
          <div className="h-24 rounded-2xl bg-[var(--bg-elevated)]" />
          <div className="h-24 rounded-2xl bg-[var(--bg-elevated)]" />
        </div>
      </div>
    );
  }

  const overdue = data?.overdue ?? [];
  const upcoming = data?.upcoming ?? [];

  return (
    <div className="max-w-[720px] mx-auto px-6 pb-24 space-y-10">
      <ReminderGroup
        title="Overdue reminders"
        reminders={overdue}
        empty="No overdue reminders."
        urgent
        onDone={(id) => completeReminder.mutate(id)}
        onDismiss={(id) => dismissReminder.mutate(id)}
        onSnooze={(id, dueAt) => snoozeReminder.mutate({ id, dueAt })}
      />

      <ReminderGroup
        title="Upcoming reminders"
        reminders={upcoming}
        empty="No upcoming reminders yet."
        urgent={false}
        onDone={(id) => completeReminder.mutate(id)}
        onDismiss={(id) => dismissReminder.mutate(id)}
        onSnooze={(id, dueAt) => snoozeReminder.mutate({ id, dueAt })}
      />
    </div>
  );
}
