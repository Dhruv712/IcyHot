"use client";

import type { MarginTuningSettings } from "@/lib/marginTuning";
import type { MarginInspectorState } from "@/hooks/useMarginIntelligence";

interface MarginLabPanelProps {
  value: MarginTuningSettings;
  onChange: (next: MarginTuningSettings) => void;
  onReset: () => void;
  onApplyPreset: (preset: "subtle" | "balanced" | "generous") => void;
  inspector: MarginInspectorState;
}

function NumberField({
  label,
  value,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2 py-1 text-[11px] text-[var(--text-primary)]"
      />
    </label>
  );
}

export default function MarginLabPanel({
  value,
  onChange,
  onReset,
  onApplyPreset,
  inspector,
}: MarginLabPanelProps) {
  const setClient = <K extends keyof MarginTuningSettings["client"]>(
    key: K,
    next: MarginTuningSettings["client"][K],
  ) => {
    onChange({
      ...value,
      client: {
        ...value.client,
        [key]: next,
      },
    });
  };

  const setServer = <K extends keyof MarginTuningSettings["server"]>(
    key: K,
    next: MarginTuningSettings["server"][K],
  ) => {
    onChange({
      ...value,
      server: {
        ...value.server,
        [key]: next,
      },
    });
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <div className="space-y-2 border border-[var(--border-subtle)] rounded-xl p-3 bg-[var(--bg-elevated)]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Live Trace
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full ${
              inspector.phase === "querying"
                ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                : inspector.phase === "error"
                  ? "bg-red-500/10 text-red-400"
                  : "bg-[var(--bg-base)] text-[var(--text-muted)]"
            }`}
          >
            {inspector.phase}
          </span>
        </div>
        <div className="text-xs text-[var(--text-secondary)]">{inspector.message}</div>
        {inspector.paragraphPreview && (
          <div className="text-[11px] text-[var(--text-muted)] italic line-clamp-2">
            &ldquo;{inspector.paragraphPreview}&rdquo;
          </div>
        )}
        {inspector.trace && (
          <div className="text-[11px] space-y-1.5 mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
            <div className="text-[var(--text-secondary)]">{inspector.trace.reason}</div>
            {inspector.trace.retrieval && (
              <div className="space-y-0.5 text-[var(--text-muted)]">
                <div>
                  Retrieval: {inspector.trace.retrieval.strongMemories}/
                  {inspector.trace.retrieval.totalMemories} strong
                </div>
                <div>
                  Top: {inspector.trace.retrieval.topScore.toFixed(3)} vs{" "}
                  {inspector.trace.retrieval.secondScore.toFixed(3)} · clear signal:{" "}
                  {inspector.trace.retrieval.hasClearSignal ? "yes" : "no"}
                </div>
                <div>
                  Implications: {inspector.trace.retrieval.implications}
                </div>
              </div>
            )}
            {inspector.trace.llm && (
              <div className="text-[var(--text-muted)]">
                LLM: accepted {inspector.trace.llm.accepted}/
                {inspector.trace.llm.rawCandidates} · mode {inspector.trace.llm.failureMode} · min conf {inspector.trace.llm.minModelConfidence}
              </div>
            )}
            <div className="text-[var(--text-muted)]">
              Timing: retrieve {inspector.trace.timingsMs.retrieve}ms · llm{" "}
              {inspector.trace.timingsMs.llm}ms · total {inspector.trace.timingsMs.total}ms
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Presets
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => onApplyPreset("subtle")}
            className="text-[11px] px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            Subtle
          </button>
          <button
            onClick={() => onApplyPreset("balanced")}
            className="text-[11px] px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            Balanced
          </button>
          <button
            onClick={() => onApplyPreset("generous")}
            className="text-[11px] px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            Generous
          </button>
        </div>
      </div>

      <div className="space-y-2 border border-[var(--border-subtle)] rounded-xl p-3 bg-[var(--bg-elevated)]">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Pacing (Client)
        </div>
        <NumberField
          label="Debounce ms"
          value={value.client.debounceMs}
          min={500}
          max={15000}
          onChange={(n) => setClient("debounceMs", n)}
        />
        <NumberField
          label="Min length"
          value={value.client.minParagraphLength}
          min={10}
          max={500}
          onChange={(n) => setClient("minParagraphLength", n)}
        />
        <NumberField
          label="Min words"
          value={value.client.minParagraphWords}
          min={1}
          max={60}
          onChange={(n) => setClient("minParagraphWords", n)}
        />
        <NumberField
          label="Query gap ms"
          value={value.client.minQueryGapMs}
          min={0}
          max={60000}
          onChange={(n) => setClient("minQueryGapMs", n)}
        />
        <NumberField
          label="Cooldown ms"
          value={value.client.annotationCooldownMs}
          min={0}
          max={180000}
          onChange={(n) => setClient("annotationCooldownMs", n)}
        />
        <NumberField
          label="Max notes/entry"
          value={value.client.maxAnnotationsPerEntry}
          min={1}
          max={30}
          onChange={(n) => setClient("maxAnnotationsPerEntry", n)}
        />
        <NumberField
          label="Para gap"
          value={value.client.minParagraphGap}
          min={0}
          max={20}
          onChange={(n) => setClient("minParagraphGap", n)}
        />
      </div>

      <div className="space-y-2 border border-[var(--border-subtle)] rounded-xl p-3 bg-[var(--bg-elevated)]">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Relevance (Server)
        </div>
        <NumberField
          label="Min score"
          value={value.server.minActivationScore}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(n) => setServer("minActivationScore", n)}
        />
        <NumberField
          label="Top activation"
          value={value.server.minTopActivation}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(n) => setServer("minTopActivation", n)}
        />
        <NumberField
          label="Top gap"
          value={value.server.minTopGap}
          min={0}
          max={0.5}
          step={0.005}
          onChange={(n) => setServer("minTopGap", n)}
        />
        <NumberField
          label="Strong override"
          value={value.server.strongTopOverride}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(n) => setServer("strongTopOverride", n)}
        />
        <NumberField
          label="Model confidence"
          value={value.server.minModelConfidence}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(n) => setServer("minModelConfidence", n)}
        />
        <NumberField
          label="Server min words"
          value={value.server.minParagraphWords}
          min={1}
          max={40}
          onChange={(n) => setServer("minParagraphWords", n)}
        />
        <NumberField
          label="Memories context"
          value={value.server.maxMemoriesContext}
          min={1}
          max={12}
          onChange={(n) => setServer("maxMemoriesContext", n)}
        />
        <NumberField
          label="Implications ctx"
          value={value.server.maxImplicationsContext}
          min={0}
          max={8}
          onChange={(n) => setServer("maxImplicationsContext", n)}
        />
      </div>

      <div className="space-y-2 border border-[var(--border-subtle)] rounded-xl p-3 bg-[var(--bg-elevated)]">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Prompt Addendum
        </div>
        <textarea
          value={value.promptAddendum}
          onChange={(e) =>
            onChange({
              ...value,
              promptAddendum: e.target.value,
            })
          }
          rows={4}
          placeholder="Add extra guidance. Example: Prefer paradoxes over direct contradictions."
          className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div className="space-y-2 border border-[var(--border-subtle)] rounded-xl p-3 bg-[var(--bg-elevated)]">
        <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Prompt Override (Advanced)
        </div>
        <textarea
          value={value.promptOverride}
          onChange={(e) =>
            onChange({
              ...value,
              promptOverride: e.target.value,
            })
          }
          rows={6}
          placeholder={"Use tokens: {{entryDate}} {{entry}} {{paragraph}} {{memories}} {{implications}}"}
          className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <button
        onClick={onReset}
        className="w-full text-xs px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
      >
        Reset To Defaults
      </button>
    </div>
  );
}
