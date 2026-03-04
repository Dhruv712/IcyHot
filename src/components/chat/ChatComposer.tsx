"use client";

import { useState } from "react";

export default function ChatComposer({
  onSend,
  disabled = false,
}: {
  onSend: (content: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setValue("");
    await onSend(trimmed);
  };

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-4 md:px-6">
      <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-sm">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder="Ask about a person, pattern, or past event..."
          className="max-h-40 min-h-[72px] flex-1 resize-none bg-transparent px-2 py-1 text-[15px] leading-7 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || !value.trim()}
          className="rounded-full bg-[var(--amber)] px-4 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
