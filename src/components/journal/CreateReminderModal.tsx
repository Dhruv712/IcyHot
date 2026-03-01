"use client";

import { useMemo, useState } from "react";
import Modal, { ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import type { ContactRecord } from "@/hooks/useContacts";

type RepeatRule = "none" | "daily" | "weekly" | "monthly";

export interface ReminderDraft {
  sourceText: string;
  title: string;
  body: string;
  dueDate: string;
  repeatRule: RepeatRule;
  contactId: string;
  selectionAnchor?: unknown;
}

function defaultDueDate(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export default function CreateReminderModal({
  contacts,
  initialValue,
  onClose,
  onSubmit,
  submitting = false,
}: {
  contacts: ContactRecord[];
  initialValue: ReminderDraft;
  onClose: () => void;
  onSubmit: (value: ReminderDraft) => void;
  submitting?: boolean;
}) {
  const [title, setTitle] = useState(initialValue.title);
  const [body, setBody] = useState(initialValue.body);
  const [dueDate, setDueDate] = useState(initialValue.dueDate || defaultDueDate());
  const [repeatRule, setRepeatRule] = useState<RepeatRule>(initialValue.repeatRule);
  const [contactId, setContactId] = useState(initialValue.contactId);

  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );

  return (
    <Modal onClose={onClose} maxWidth="md">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-lg font-medium text-[var(--text-primary)]">Create reminder</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Reminders appear on the dashboard and can later drive notifications.
          </p>
        </div>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Highlighted text
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            {initialValue.sourceText}
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Title
          </span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--amber)]"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Due date
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--amber)]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Repeat
            </span>
            <select
              value={repeatRule}
              onChange={(event) => setRepeatRule(event.target.value as RepeatRule)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--amber)]"
            >
              <option value="none">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Linked person
          </span>
          <select
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--amber)]"
          >
            <option value="">None</option>
            {sortedContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Note
          </span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--amber)]"
          />
        </label>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={submitting || !title.trim() || !dueDate}
          onClick={() =>
            onSubmit({
              ...initialValue,
              title: title.trim(),
              body: body.trim(),
              dueDate,
              repeatRule,
              contactId,
            })
          }
          className="rounded-full bg-[var(--amber)] px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--bg-base)] transition-colors hover:bg-[var(--amber-hover)] disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Create"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
