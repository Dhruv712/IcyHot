"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useJournalEntry,
  useJournalEntries,
  useSaveJournalEntry,
} from "@/hooks/useJournal";
import dynamic from "next/dynamic";
import type { MarkdownEditorHandle } from "@/components/journal/MarkdownEditor";

// Dynamic import to avoid SSR issues with Tiptap
const MarkdownEditor = dynamic(
  () => import("@/components/journal/MarkdownEditor"),
  { ssr: false }
);

export default function JournalPage() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [showEntries, setShowEntries] = useState(false);

  const { data: entry, isLoading } = useJournalEntry(selectedDate);
  const { data: entriesData } = useJournalEntries();
  const saveMutation = useSaveJournalEntry();

  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [currentSha, setCurrentSha] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [latestMarkdown, setLatestMarkdown] = useState("");

  const editorRef = useRef<MarkdownEditorHandle>(null);

  // Sync SHA when entry loads
  useEffect(() => {
    if (entry) {
      setCurrentSha(entry.sha);
      setIsDirty(false);
      setLatestMarkdown(entry.content);
    }
  }, [entry]);

  // Date display
  const displayDate = selectedDate
    ? new Date(selectedDate + "T12:00:00")
    : new Date();
  const dateDisplay = displayDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = !selectedDate || selectedDate === todayStr;

  const handleEditorChange = useCallback((markdown: string) => {
    setLatestMarkdown(markdown);
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!entry?.filename || !isDirty || saveMutation.isPending) return;

    const content = editorRef.current?.getMarkdown() ?? latestMarkdown;

    saveMutation.mutate(
      { content, filename: entry.filename, sha: currentSha },
      {
        onSuccess: (result) => {
          setCurrentSha(result.sha);
          setIsDirty(false);
          setLastSavedAt(new Date());
          setShowToast(true);
          setTimeout(() => setShowToast(false), 4000);
        },
      }
    );
  }, [entry?.filename, currentSha, isDirty, saveMutation, latestMarkdown]);

  // Cmd+S / Ctrl+S keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  const handleSelectEntry = useCallback((date: string) => {
    setSelectedDate(date === todayStr ? undefined : date);
    setIsDirty(false);
    setLastSavedAt(null);
    setShowEntries(false);
  }, [todayStr]);

  // Group entries by month
  const entriesByMonth = new Map<string, typeof entries>();
  const entries = entriesData?.entries ?? [];
  for (const e of entries) {
    const d = new Date(e.date + "T12:00:00");
    const key = d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    const existing = entriesByMonth.get(key) ?? [];
    existing.push(e);
    entriesByMonth.set(key, existing);
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-[var(--text-muted)] text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden bg-[var(--bg-base)]">
      {/* ── Entries Sidebar (desktop: always, mobile: toggle) ──────── */}
      <aside
        className={`${
          showEntries ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } fixed md:relative z-20 md:z-auto h-full w-[240px] flex-shrink-0 bg-[var(--bg-card)] border-r border-[var(--border-subtle)] transition-transform duration-200 flex flex-col`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            Entries
          </span>
          <button
            onClick={() => handleSelectEntry(todayStr)}
            className="text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors"
            title="Go to today"
          >
            Today
          </button>
        </div>

        {/* Entries list */}
        <div className="flex-1 overflow-y-auto py-2">
          {Array.from(entriesByMonth.entries()).map(([month, monthEntries]) => (
            <div key={month}>
              <div className="px-4 py-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {month}
              </div>
              {monthEntries!.map((e) => {
                const isActive =
                  (selectedDate === e.date) ||
                  (!selectedDate && e.date === todayStr);
                const d = new Date(e.date + "T12:00:00");
                const day = d.getDate();
                const weekday = d.toLocaleDateString("en-US", { weekday: "short" });

                return (
                  <button
                    key={e.date}
                    onClick={() => handleSelectEntry(e.date)}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-3 ${
                      isActive
                        ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span className={`text-lg font-light w-7 text-right ${isActive ? "text-[var(--amber)]" : "text-[var(--text-muted)]"}`}>
                      {day}
                    </span>
                    <span className="text-xs">{weekday}</span>
                  </button>
                );
              })}
            </div>
          ))}

          {entries.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
              No entries yet
            </div>
          )}
        </div>
      </aside>

      {/* Mobile overlay backdrop */}
      {showEntries && (
        <div
          className="fixed inset-0 z-10 bg-black/30 md:hidden"
          onClick={() => setShowEntries(false)}
        />
      )}

      {/* ── Main Editor ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 md:px-8">
          <div className="flex items-center gap-3">
            {/* Mobile entries toggle */}
            <button
              onClick={() => setShowEntries(!showEntries)}
              className="md:hidden text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase">
              {dateDisplay}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Save status */}
            <span className="text-xs text-[var(--text-muted)]">
              {saveMutation.isPending
                ? "Saving..."
                : isDirty
                ? "Unsaved changes"
                : lastSavedAt
                ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : entry?.exists
                ? ""
                : isToday
                ? "New entry"
                : ""}
            </span>
            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={!isDirty || saveMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-[var(--amber)] text-white font-medium disabled:opacity-30 hover:bg-[var(--amber-hover)] transition-colors"
            >
              Save
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[680px] mx-auto px-6 pb-24 md:px-8">
            <MarkdownEditor
              ref={editorRef}
              key={selectedDate ?? "today"}
              initialContent={entry?.content ?? ""}
              onChange={handleEditorChange}
              placeholder="Start writing..."
            />
          </div>
        </div>

        {/* Post-save toast */}
        {showToast && saveMutation.data && (
          <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div
              className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-secondary)] shadow-lg"
              style={{ animation: "slideDown 0.2s ease-out" }}
            >
              {saveMutation.data.memory.memoriesCreated > 0
                ? `Saved — ${saveMutation.data.memory.memoriesCreated} memories created`
                : "Saved & synced"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
