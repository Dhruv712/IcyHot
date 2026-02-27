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
import { useMarginIntelligence } from "@/hooks/useMarginIntelligence";
import MarginAnnotations from "@/components/journal/MarginAnnotations";
import SparkCards from "@/components/journal/SparkCards";
import MarginLabPanel from "@/components/journal/MarginLabPanel";
import { useGravityWell } from "@/hooks/useGravityWell";
import GravityWellMap from "@/components/journal/GravityWellMap";
import {
  coerceMarginTuning,
  DEFAULT_MARGIN_TUNING,
  MARGIN_TUNING_STORAGE_KEY,
  type MarginTuningSettings,
} from "@/lib/marginTuning";

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
  const [sidebarMode, setSidebarMode] = useState<"entries" | "map" | "lab">("entries");
  const [focusMode, setFocusMode] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [marginTuning, setMarginTuning] = useState<MarginTuningSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_MARGIN_TUNING;
    try {
      const raw = localStorage.getItem(MARGIN_TUNING_STORAGE_KEY);
      if (!raw) return DEFAULT_MARGIN_TUNING;
      return coerceMarginTuning(JSON.parse(raw));
    } catch {
      return DEFAULT_MARGIN_TUNING;
    }
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const entryDate = selectedDate ?? todayStr;

  const { data: entry, isLoading } = useJournalEntry(selectedDate);
  const { data: entriesData } = useJournalEntries();
  const saveMutation = useSaveJournalEntry();
  const {
    annotations: marginAnnotations,
    nudges: sparkNudges,
    handleParagraphChange: handleMarginParagraph,
    dismissAnnotation,
    dismissNudge,
    expandNudge,
    submitNudgeFeedback,
    inspector: marginInspector,
    sparkSummary,
  } = useMarginIntelligence({
    entryDate,
    enabled: !isLoading,
    tuning: marginTuning,
  });

  const {
    clusters,
    memoryDots,
    currentPosition,
    trail,
    handleParagraphChange: handleGravityParagraph,
  } = useGravityWell({ entryDate, enabled: !isLoading });

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [editorElement, setEditorElement] = useState<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const [sidebarSize, setSidebarSize] = useState({ width: 240, height: 400 });
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSaveRef = useRef<() => void>(() => {});
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const entryDateRef = useRef(entryDate);
  const focusModeRef = useRef(focusMode);

  const setEditorContainer = useCallback((el: HTMLDivElement | null) => {
    editorContainerRef.current = el;
    setEditorElement(el);
  }, []);

  // Persist margin tuning locally
  useEffect(() => {
    try {
      localStorage.setItem(
        MARGIN_TUNING_STORAGE_KEY,
        JSON.stringify(marginTuning),
      );
    } catch (error) {
      console.warn("[margin-lab] Failed to persist tuning:", error);
    }
  }, [marginTuning]);

  const applyMarginPreset = useCallback(
    (preset: "subtle" | "balanced" | "generous") => {
      const promptAddendum = marginTuning.promptAddendum;
      const promptOverride = marginTuning.promptOverride;

      if (preset === "subtle") {
        setMarginTuning(
          coerceMarginTuning({
            ...DEFAULT_MARGIN_TUNING,
            client: {
              ...DEFAULT_MARGIN_TUNING.client,
              debounceMs: 5000,
              minQueryGapMs: 12000,
              annotationCooldownMs: 50000,
              maxAnnotationsPerEntry: 4,
              minParagraphLength: 40,
              minParagraphWords: 10,
            },
            server: {
              ...DEFAULT_MARGIN_TUNING.server,
              minActivationScore: 0.12,
              minTopActivation: 0.14,
              minTopGap: 0.03,
              strongTopOverride: 0.22,
              minModelConfidence: 0.8,
              minOverallUtility: 4.2,
              minSpecificityScore: 4.0,
              minActionabilityScore: 3.9,
            },
            promptAddendum,
            promptOverride,
          }),
        );
        return;
      }

      if (preset === "generous") {
        setMarginTuning(
          coerceMarginTuning({
            ...DEFAULT_MARGIN_TUNING,
            client: {
              ...DEFAULT_MARGIN_TUNING.client,
              debounceMs: 2200,
              minQueryGapMs: 3500,
              annotationCooldownMs: 9000,
              maxAnnotationsPerEntry: 14,
              minParagraphLength: 20,
              minParagraphWords: 5,
            },
            server: {
              ...DEFAULT_MARGIN_TUNING.server,
              minActivationScore: 0.07,
              minTopActivation: 0.08,
              minTopGap: 0.008,
              strongTopOverride: 0.14,
              minModelConfidence: 0.64,
              minOverallUtility: 3.6,
              minSpecificityScore: 3.0,
              minActionabilityScore: 3.0,
              maxMemoriesContext: 6,
              maxImplicationsContext: 3,
            },
            promptAddendum,
            promptOverride,
          }),
        );
        return;
      }

      setMarginTuning({
        ...DEFAULT_MARGIN_TUNING,
        promptAddendum,
        promptOverride,
      });
    },
    [marginTuning.promptAddendum, marginTuning.promptOverride],
  );

  // Keep refs in sync
  useEffect(() => {
    entryDateRef.current = entryDate;
  }, [entryDate]);
  useEffect(() => {
    focusModeRef.current = focusMode;
    if (!focusMode) setChromeHidden(false);
  }, [focusMode]);

  // Sync focus state to body so CSS can hide the left nav sidebar too
  useEffect(() => {
    if (chromeHidden) {
      document.body.setAttribute("data-journal-focus", "");
    } else {
      document.body.removeAttribute("data-journal-focus");
    }
    return () => document.body.removeAttribute("data-journal-focus");
  }, [chromeHidden]);

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
            if (isDirtyRef.current) doSaveRef.current();
          }, 5000);
        },
      }
    );
  }, [saveMutation, queryClient, todayStr]);

  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // ── Schedule autosave on change ─────────────────────────────────────
  const handleEditorChange = useCallback(
    () => {
      isDirtyRef.current = true;
      setSaveStatus("idle");

      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        doSave();
      }, AUTOSAVE_DELAY);
    },
    [doSave]
  );

  // ── Paragraph change → margin intelligence + gravity well ──────────
  const handleActiveParagraph = useCallback(
    (p: { index: number; text: string }) => {
      const fullMd = editorRef.current?.getMarkdown() ?? "";
      handleMarginParagraph(p, fullMd);
      handleGravityParagraph(p);
    },
    [handleMarginParagraph, handleGravityParagraph]
  );

  // ── Measure sidebar content area for GravityWellMap ───────────────
  useEffect(() => {
    const el = sidebarContentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSidebarSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
            <p className="text-sm text-[var(--text-muted)] tracking-wide uppercase">
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

            {/* Margin trace status */}
            <span
              className={`text-[11px] ${
                marginInspector.phase === "querying"
                  ? "text-[var(--amber)]"
                  : marginInspector.phase === "error"
                    ? "text-red-400"
                    : "text-[var(--text-muted)]"
              }`}
              title={marginInspector.trace?.reason || marginInspector.message}
            >
              {marginInspector.phase === "querying"
                ? "Margin: scanning..."
                : `Margin: ${marginInspector.message}`}
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
            ref={setEditorContainer}
            className="relative max-w-[680px] mx-auto px-6 pb-24 md:px-8"
          >
            <MarkdownEditor
              ref={editorRef}
              key={selectedDate ?? "today"}
              initialContent={entry?.content ?? ""}
              onChange={handleEditorChange}
              onActiveParagraph={handleActiveParagraph}
              placeholder="Start writing..."
            />
            {sparkNudges.length > 0 ? (
              <SparkCards
                nudges={sparkNudges}
                editorElement={editorElement}
                onDismiss={dismissNudge}
                onExpand={expandNudge}
                onFeedback={submitNudgeFeedback}
              />
            ) : (
              <MarginAnnotations
                annotations={marginAnnotations}
                editorElement={editorElement}
                onDismiss={dismissAnnotation}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Entries Sidebar (RIGHT, with collapse chevron) ──────── */}
      <aside
        className={`hidden md:flex h-full flex-shrink-0 bg-[var(--bg-card)] border-l border-[var(--border-subtle)] transition-all duration-200 flex-col ${
          sidebarOpen ? "w-[240px]" : "w-[44px]"
        } ${chromeHidden ? (sidebarMode === "map" ? "opacity-40" : "opacity-0 pointer-events-none") : "opacity-100"}`}
        style={{ transition: "width 200ms, opacity 500ms" }}
      >
        {/* Sidebar header with mode toggle + collapse chevron */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border-subtle)]">
          {sidebarOpen && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide">
                <button
                  onClick={() => setSidebarMode("entries")}
                  className={`transition-colors ${
                    sidebarMode === "entries"
                      ? "text-[var(--amber)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  Entries
                </button>
                <span className="text-[var(--text-muted)]">/</span>
                <button
                  onClick={() => setSidebarMode("map")}
                  className={`transition-colors ${
                    sidebarMode === "map"
                      ? "text-[var(--amber)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  Map
                </button>
                <span className="text-[var(--text-muted)]">/</span>
                <button
                  onClick={() => setSidebarMode("lab")}
                  className={`transition-colors ${
                    sidebarMode === "lab"
                      ? "text-[var(--amber)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  Lab
                </button>
              </div>
              {sidebarMode === "entries" && (
                <button
                  onClick={() => handleSelectEntry(todayStr)}
                  className="text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors ml-auto"
                  title="Go to today"
                >
                  Today
                </button>
              )}
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

        {/* Sidebar content (hidden when collapsed) */}
        {sidebarOpen && (
          <div ref={sidebarContentRef} className="flex-1 overflow-hidden">
            {sidebarMode === "entries" ? (
              <div className="h-full overflow-y-auto py-2">
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
            ) : sidebarMode === "map" ? (
              <div className="h-full flex items-center justify-center p-2">
                <GravityWellMap
                  clusters={clusters}
                  memoryDots={memoryDots}
                  currentPosition={currentPosition}
                  trail={trail}
                  width={sidebarSize.width - 16}
                  height={sidebarSize.height - 16}
                />
              </div>
            ) : (
              <MarginLabPanel
                value={marginTuning}
                onChange={(next) => setMarginTuning(coerceMarginTuning(next))}
                onApplyPreset={applyMarginPreset}
                onReset={() => setMarginTuning(DEFAULT_MARGIN_TUNING)}
                inspector={marginInspector}
                sparkSummary={sparkSummary}
              />
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
