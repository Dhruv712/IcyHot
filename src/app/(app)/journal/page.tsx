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

const AUTOSAVE_DELAY = 2_000; // 2s after last keystroke

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function JournalPage() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>(
    undefined
  );
  const [showEntries, setShowEntries] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const entryDate = selectedDate ?? todayStr;

  const { data: entry, isLoading } = useJournalEntry(selectedDate);
  const { data: entriesData } = useJournalEntries();
  const saveMutation = useSaveJournalEntry();

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const entryDateRef = useRef(entryDate);

  // Keep entryDate ref in sync
  useEffect(() => {
    entryDateRef.current = entryDate;
  }, [entryDate]);

  // Reset dirty state when entry loads
  useEffect(() => {
    if (entry) {
      isDirtyRef.current = false;
      setSaveStatus("idle");
    }
  }, [entry]);

  // Date display
  const displayDate = new Date(entryDate + "T12:00:00");
  const dateDisplay = displayDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // ── Core save function ──────────────────────────────────────────────
  const doSave = useCallback(() => {
    const content =
      editorRef.current?.getMarkdown() ?? "";

    if (!content.trim() || isSavingRef.current) return;
    if (!isDirtyRef.current) return;

    isSavingRef.current = true;
    setSaveStatus("saving");

    saveMutation.mutate(
      {
        content,
        entryDate: entryDateRef.current,
      },
      {
        onSuccess: () => {
          isDirtyRef.current = false;
          isSavingRef.current = false;
          setSaveStatus("saved");

          // Fade status back to idle after 3s
          if (savedFadeTimerRef.current)
            clearTimeout(savedFadeTimerRef.current);
          savedFadeTimerRef.current = setTimeout(
            () => setSaveStatus("idle"),
            3000
          );
        },
        onError: () => {
          isSavingRef.current = false;
          setSaveStatus("error");

          // Retry after 5s
          setTimeout(() => {
            if (isDirtyRef.current) doSave();
          }, 5000);
        },
      }
    );
  }, [saveMutation]);

  // ── Schedule autosave on change ─────────────────────────────────────
  const handleEditorChange = useCallback(
    (_markdown: string) => {
      isDirtyRef.current = true;
      setSaveStatus("idle"); // clear "Saved" while typing

      // Clear existing timer
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

      // Save after 2s idle
      autosaveTimerRef.current = setTimeout(() => {
        doSave();
      }, AUTOSAVE_DELAY);
    },
    [doSave]
  );

  // ── Cmd+S force-save ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        doSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [doSave]);

  // ── Save on page blur / tab switch ──────────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && isDirtyRef.current) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        doSave();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [doSave]);

  // ── Cleanup timers ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
    };
  }, []);

  // ── Entry selection ─────────────────────────────────────────────────
  const handleSelectEntry = useCallback(
    (date: string) => {
      // Save current entry before switching if dirty
      if (isDirtyRef.current) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        doSave();
      }

      setSelectedDate(date === todayStr ? undefined : date);
      isDirtyRef.current = false;
      setSaveStatus("idle");
      setShowEntries(false);
    },
    [todayStr, doSave]
  );

  // Group entries by month
  const entriesByMonth = new Map<
    string,
    NonNullable<typeof entriesData>["entries"]
  >();
  const entries = entriesData?.entries ?? [];
  for (const e of entries) {
    const d = new Date(e.date + "T12:00:00");
    const key = d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });
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
          showEntries
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0"
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
          {Array.from(entriesByMonth.entries()).map(
            ([month, monthEntries]) => (
              <div key={month}>
                <div className="px-4 py-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  {month}
                </div>
                {monthEntries!.map((e) => {
                  const isActive =
                    selectedDate === e.date ||
                    (!selectedDate && e.date === todayStr);
                  const d = new Date(e.date + "T12:00:00");
                  const day = d.getDate();
                  const weekday = d.toLocaleDateString("en-US", {
                    weekday: "short",
                  });

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
                      <span
                        className={`text-lg font-light w-7 text-right ${
                          isActive
                            ? "text-[var(--amber)]"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        {day}
                      </span>
                      <span className="text-xs">{weekday}</span>
                    </button>
                  );
                })}
              </div>
            )
          )}

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
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>
            <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase">
              {dateDisplay}
            </p>
          </div>

          {/* Save status — subtle, Notion-style */}
          <span
            className={`text-xs transition-opacity duration-300 ${
              saveStatus === "idle" ? "opacity-0" : "opacity-100"
            } ${
              saveStatus === "error"
                ? "text-red-400"
                : "text-[var(--text-muted)]"
            }`}
          >
            {saveStatus === "saving" && "Saving..."}
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "error" && "Save failed — retrying..."}
          </span>
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
      </div>
    </div>
  );
}
