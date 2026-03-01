"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useJournalEntry,
  useJournalEntries,
  useSaveJournalEntry,
  type JournalEntry,
  type JournalEntryListItem,
} from "@/hooks/useJournal";
import dynamic from "next/dynamic";
import type { MarkdownEditorHandle } from "@/components/journal/MarkdownEditor";
import { useMarginIntelligence } from "@/hooks/useMarginIntelligence";
import MarginAnnotations from "@/components/journal/MarginAnnotations";
import SparkCards from "@/components/journal/SparkCards";
import MarginLabPanel from "@/components/journal/MarginLabPanel";
import NotificationToggle from "@/components/NotificationToggle";
import { useJournalSidebar } from "@/components/JournalSidebarContext";
import { useTheme } from "@/components/ThemeProvider";
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
const FLOW_MODE_STORAGE_KEY = "journal-flow-mode-enabled";
const FLOW_DEBUG_QUERY_PARAM = "flowDebug";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ModeToggle({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
    >
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${
          checked ? "bg-[var(--amber)]" : "bg-[var(--border-medium)]"
        }`}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0"
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function JournalPage() {
  const queryClient = useQueryClient();
  const { setContent: setJournalSidebarContent } = useJournalSidebar();
  const { resolved, setTheme } = useTheme();

  const [selectedDate, setSelectedDate] = useState<string | undefined>(
    undefined
  );
  const [showSidebarMobile, setShowSidebarMobile] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<"entries" | "lab">("entries");
  const [focusMode, setFocusMode] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [showFlowDebug] = useState(
    () =>
      typeof window !== "undefined" &&
      process.env.NODE_ENV !== "production" &&
      new URLSearchParams(window.location.search).get(FLOW_DEBUG_QUERY_PARAM) === "1",
  );
  const [flowDebugSummary, setFlowDebugSummary] = useState("");
  const [flowMode, setFlowMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = localStorage.getItem(FLOW_MODE_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  });
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

  const todayStr = toLocalYmd(new Date());
  const entryDate = selectedDate ?? todayStr;

  const { data: entry, isLoading } = useJournalEntry(entryDate);
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

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [editorElement, setEditorElement] = useState<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    try {
      localStorage.setItem(FLOW_MODE_STORAGE_KEY, String(flowMode));
    } catch (error) {
      console.warn("[journal] Failed to persist flow mode:", error);
    }
  }, [flowMode]);

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
              debounceMs: 3000,
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
          const queryKey = ["journal-entry", savingDate];
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
  }, [saveMutation, queryClient]);

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
    },
    [handleMarginParagraph]
  );

  const handleRevealFlow = useCallback(() => {
    editorRef.current?.revealFlow();
  }, []);

  const toggleFlowMode = useCallback(() => {
    if (flowMode) {
      handleRevealFlow();
      setFlowMode(false);
      return;
    }

    setFlowMode(true);
  }, [flowMode, handleRevealFlow]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((current) => {
      if (current) {
        setChromeHidden(false);
      }
      return !current;
    });
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
      setShowSidebarMobile(false);
    },
    [todayStr, doSave]
  );

  const entriesByMonth = useMemo<Array<{ month: string; entries: JournalEntryListItem[] }>>(
    () => {
      const groups = new Map<string, JournalEntryListItem[]>();
      for (const entryItem of entriesData?.entries ?? []) {
        const date = new Date(`${entryItem.date}T12:00:00`);
        const month = date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        });
        const existing = groups.get(month) ?? [];
        existing.push(entryItem);
        groups.set(month, existing);
      }
      return Array.from(groups.entries()).map(([month, monthEntries]) => ({
        month,
        entries: monthEntries,
      }));
    },
    [entriesData?.entries]
  );

  const renderEntriesList = useCallback(
    (variant: "desktop" | "mobile") => (
      <div className={`h-full overflow-y-auto ${variant === "desktop" ? "py-2" : "py-3"}`}>
        {entriesByMonth.map(({ month, entries: monthEntries }) => (
          <div key={month}>
            <div className="px-4 py-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-[0.16em]">
              {month}
            </div>
            {monthEntries.map((entryItem) => {
              const isActive =
                selectedDate === entryItem.date ||
                (!selectedDate && entryItem.date === todayStr);
              const date = new Date(`${entryItem.date}T12:00:00`);
              const day = date.getDate();
              const weekday = date.toLocaleDateString("en-US", {
                weekday: "short",
              });

              return (
                <button
                  key={entryItem.date}
                  onClick={() => handleSelectEntry(entryItem.date)}
                  className={`mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
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
        ))}

        {entriesByMonth.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
            No entries yet
          </div>
        )}
      </div>
    ),
    [entriesByMonth, handleSelectEntry, selectedDate, todayStr],
  );

  const renderJournalRail = useCallback(
    (variant: "desktop" | "mobile") => (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-[var(--border-subtle)] px-3 py-3">
          <div className="flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] p-1 text-[10px] font-medium uppercase tracking-[0.16em]">
            <button
              onClick={() => setSidebarMode("entries")}
              className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
                sidebarMode === "entries"
                  ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Entries
            </button>
            <button
              onClick={() => setSidebarMode("lab")}
              className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
                sidebarMode === "lab"
                  ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Lab
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {sidebarMode === "entries" ? (
            renderEntriesList(variant)
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
      </div>
    ),
    [applyMarginPreset, marginInspector, marginTuning, renderEntriesList, sidebarMode, sparkSummary],
  );

  const compactMarginNotes = false;
  const editorLayoutClass =
    "relative max-w-[820px] mx-auto px-6 pb-24 md:mx-0 md:ml-10 md:px-8 lg:ml-16";
  const desktopJournalRailContent = useMemo(
    () => renderJournalRail("desktop"),
    [renderJournalRail],
  );

  useEffect(() => {
    if (!showFlowDebug || !flowMode) return;

    const readDebug = () => {
      const debug = editorRef.current?.getFlowDebugState();
      if (!debug) {
        setFlowDebugSummary("Flow: unavailable");
        return;
      }

      setFlowDebugSummary(
        `Flow: active ${debug.activeBlockIndex + 1}/${Math.max(debug.blockCount, 1)} · faded ${debug.fadedBlockCount} · ${debug.revealed ? "revealed" : "live"}`,
      );
    };

    readDebug();
    const interval = window.setInterval(readDebug, 300);
    return () => window.clearInterval(interval);
  }, [flowMode, showFlowDebug]);

  useEffect(() => {
    setJournalSidebarContent(desktopJournalRailContent);
    return () => setJournalSidebarContent(null);
  }, [desktopJournalRailContent, setJournalSidebarContent]);

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
            <button
              onClick={() => setShowSidebarMobile((value) => !value)}
              className="md:hidden text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title="Open sidebar"
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

          <div className="flex items-center gap-3">
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

            {showFlowDebug && flowMode && (
              <span className="hidden md:inline text-[11px] text-[var(--text-muted)]">
                {flowDebugSummary}
              </span>
            )}

            <div className="hidden md:flex items-center gap-2">
              <NotificationToggle compact />
              <button
                type="button"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
                title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
                aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
              >
                <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {resolved === "dark" ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                  )}
                </svg>
              </button>
              <ModeToggle label="Flow" checked={flowMode} onToggle={toggleFlowMode} />
              <ModeToggle label="Focus" checked={focusMode} onToggle={toggleFocusMode} />
            </div>
          </div>
        </div>

        {/* Editor area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div
            ref={setEditorContainer}
            className={editorLayoutClass}
          >
            <MarkdownEditor
              ref={editorRef}
              key={selectedDate ?? "today"}
              initialContent={entry?.content ?? ""}
              onChange={handleEditorChange}
              onActiveParagraph={handleActiveParagraph}
              placeholder="Start writing..."
              flowMode={flowMode}
            />
            {sparkNudges.length > 0 ? (
              <SparkCards
                nudges={sparkNudges}
                editorElement={editorElement}
                compactMode={compactMarginNotes}
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
      {showSidebarMobile && (
        <>
          <div
            className="fixed inset-0 z-10 bg-black/30 md:hidden"
            onClick={() => setShowSidebarMobile(false)}
          />
          <aside className="fixed left-0 z-20 h-full w-[320px] max-w-[90vw] bg-[var(--bg-card)] border-r border-[var(--border-subtle)] flex flex-col md:hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Journal
              </span>
              <button
                onClick={() => setShowSidebarMobile(false)}
                className="text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors uppercase tracking-[0.18em]"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{renderJournalRail("mobile")}</div>
          </aside>
        </>
      )}
    </div>
  );
}
