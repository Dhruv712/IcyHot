"use client";

import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import { useJournalNewPeople, useJournalNewPersonAction } from "@/hooks/useJournal";

export default function NewPeopleCard() {
  const { data: people, isLoading } = useJournalNewPeople();
  const personAction = useJournalNewPersonAction();

  if (isLoading) return null;
  if (!people?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle icon="👤">New People</CardTitle>
        <span className="text-xs text-[var(--text-muted)]">From your journal</span>
      </CardHeader>
      <div className="space-y-2.5">
        {people.map((person) => (
          <div key={person.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
            <div className="text-sm font-medium text-[var(--text-primary)]">{person.name}</div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
              {person.context}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                {person.entryDate}
                {person.category === "passing_mention" && (
                  <span className="ml-1.5 opacity-60">(passing mention)</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => personAction.mutate({ id: person.id, action: "add" })}
                  disabled={personAction.isPending}
                  className="text-xs bg-[var(--amber)] hover:bg-[var(--amber-hover)] disabled:opacity-50 text-[var(--bg-base)] font-medium px-3 py-1 rounded-lg transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => personAction.mutate({ id: person.id, action: "dismiss" })}
                  disabled={personAction.isPending}
                  className="text-xs bg-[var(--bg-card)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
