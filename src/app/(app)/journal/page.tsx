"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useJournalEntry, useSaveJournalEntry } from "@/hooks/useJournal";

export default function JournalPage() {
  const { data: entry, isLoading } = useJournalEntry();
  const saveMutation = useSaveJournalEntry();

  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [currentSha, setCurrentSha] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load entry content when data arrives
  useEffect(() => {
    if (entry) {
      setContent(entry.content);
      setCurrentSha(entry.sha);
      setIsDirty(false);
    }
  }, [entry]);

  // Auto-focus the textarea
  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  // Format today's date for display
  const today = new Date();
  const dateDisplay = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!entry?.filename || !isDirty || saveMutation.isPending) return;

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
  }, [content, entry?.filename, currentSha, isDirty, saveMutation]);

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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--text-muted)] text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--bg-base)]">
      {/* Minimal header */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 md:px-8">
        <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase">
          {dateDisplay}
        </p>
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
              : "New entry"}
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

      {/* Editor — the zen garden */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[680px] mx-auto px-6 pb-24 md:px-8">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            placeholder="Start writing..."
            spellCheck={false}
            className="w-full min-h-[calc(100vh-120px)] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-base leading-relaxed resize-none outline-none"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
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
  );
}
