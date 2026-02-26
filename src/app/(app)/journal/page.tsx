"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useJournalEntry,
  useJournalEntries,
  useSaveJournalEntry,
  type JournalEntry,
} from "@/hooks/useJournal";
import dynamic from "next/dynamic";
import type { MarkdownEditorHandle } from "@/components/journal/MarkdownEditor";

const MarkdownEditor = dynamic(
  () => import("@/components/journal/MarkdownEditor"),
  { ssr: false }
);

const AUTOSAVE_DELAY = 2_000;
const FOCUS_MOUSE_IDLE = 2_000; // re-fade after mouse stops for 2s

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function JournalPage() {
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string | undefined>(
    undefined
  );
  const [showEntries, setShowEntries] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const entryDate = selectedDate ?? todayStr;

  const { data: entry, isLoading } = useJournalEntry(selectedDate);
  const { data: entriesData } = useJournalEntries();
  const saveMutation = useSaveJournalEntry();

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const entryDateRef = useRef(entryDate);
  const focusModeRef = useRef(focusMode);

  // Keep refs in sync
  useEffect(() => {
    entryDateRef.current = entryDate;
  }, [entryDate]);
  useEffect(() => {
    focusModeRef.current = focusMode;
    if (!focusMode) setChromeHidden(false);
  }, [focusMode]);

  // Reset dirty state when entry loads
  useEffect(() => {
    if (entry) {
      isDirtyRef.current = false;
      setSaveStatus("idle");
    }
  }, [entry]);

  // Scroll to top when switching entries
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [entryDate]);

  // ── Focus mode: keydown on editor container ─────────────────────────
  // Uses a direct DOM listener so it doesn't depend on Tiptap's stale closures
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handleKeyDown = () => {
      if (focusModeRef.current) {
        setChromeHidden(true);
        if (mouseIdleTimerRef.current)
          clearTimeout(mouseIdleTimerRef.current);
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Focus mode: mouse movement reveals chrome ──────────────────────
  useEffect(() => {
    if (!focusMode) return;

    const handleMouseMove = () => {
      setChromeHidden(false);
      if (mouseIdleTimerRef.current)
        clearTimeout(mouseIdleTimerRef.current);
      mouseIdleTimerRef.current = setTimeout(() => {
        // Re-fade only if the editor is still focused
        const active = document.activeElement;
        if (active?.closest(".journal-editor-content")) {
          setChromeHidden(true);
        }
      }, FOCUS_MOUSE_IDLE);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (mouseIdleTimerRef.current)
        clearTimeout(mouseIdleTimerRef.current);
    };
  }, [focusMode]);

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
    const content = editorRef.current?.getMarkdown() ?? "";

    if (!content.trim() || isSavingRef.current) return;
    if (!isDirtyRef.current) return;

    const savingDate = entryDateRef.current;
    isSavingRef.current = true;
    setSaveStatus("saving");

    saveMutation.mutate(
      { content, entryDate: savingDate },
      {
        onSuccess: () => {
          isDirtyRef.current = false;
          isSavingRef.current = false;
          setSaveStatus("saved");

          // Update the react-query cache so navigating back shows latest
          const queryKey = [
            "journal-entry",
            savingDate === todayStr ? "today" : savingDate,
          ];
          queryClient.setQueryData<JournalEntry>(queryKey, (old) =>
            old ? { ...old, content, exists: true, source: "db" } : old
          );

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
          setTimeout(() => {
            if (isDirtyRef.current) doSave();
          }, 5000);
        },
      }
    );
  }, [saveMutation, queryClient, todayStr]);

  // ── Schedule autosave on change ─────────────────────────────────────
  const handleEditorChange = useCallback(
    (_markdown: string) => {
      isDirtyRef.current = true;
      setSaveStatus("idle");

      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
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
      if (mouseIdleTimerRef.current) clearTimeout(mouseIdleTimerRef.current);
    };
  }, []);

  // ── Entry selection ─────────────────────────────────────────────────
  const handleSelectEntry = useCallback(
    (date: string) => {
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
      {/* ── Main Editor ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className={`flex-shrink-0 flex items-center justify-between px-6 py-4 md:px-8 transition-opacity duration-500 ${
            chromeHidden ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
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

          <div className="flex items-center gap-4">
            {/* Save status */}
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

            {/* Focus mode toggle */}
            <button
              onClick={() => setFocusMode(!focusMode)}
              className={`transition-colors ${
                focusMode
                  ? "text-[var(--amber)] hover:text-[var(--amber-hover)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              title={focusMode ? "Exit focus mode" : "Focus mode"}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                {focusMode ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div
            ref={editorContainerRef}
            className="max-w-[680px] mx-auto px-6 pb-24 md:px-8"
          >
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

      {/* ── Entries Sidebar (RIGHT, with collapse chevron) ──────── */}
      <aside
        className={`hidden md:flex h-full flex-shrink-0 bg-[var(--bg-card)] border-l border-[var(--border-subtle)] transition-all duration-200 flex-col ${
          sidebarOpen ? "w-[240px]" : "w-[44px]"
        } ${chromeHidden ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        style={{ transition: "width 200ms, opacity 500ms" }}
      >
        {/* Sidebar header with collapse chevron */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border-subtle)]">
          {sidebarOpen && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Entries
              </span>
              <button
                onClick={() => handleSelectEntry(todayStr)}
                className="text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors ml-auto"
                title="Go to today"
              >
                Today
              </button>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"
            title={sidebarOpen ? "Collapse entries" : "Expand entries"}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {sidebarOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Entries list (hidden when collapsed) */}
        {sidebarOpen && (
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
        )}
      </aside>

      {/* ── Mobile entries sidebar (slides from right) ─────────── */}
      {showEntries && (
        <>
          <div
            className="fixed inset-0 z-10 bg-black/30 md:hidden"
            onClick={() => setShowEntries(false)}
          />
          <aside className="fixed right-0 z-20 h-full w-[260px] bg-[var(--bg-card)] border-l border-[var(--border-subtle)] flex flex-col md:hidden animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Entries
              </span>
              <button
                onClick={() => handleSelectEntry(todayStr)}
                className="text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors"
              >
                Today
              </button>
            </div>
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
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
