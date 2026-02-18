"use client";

import { useWeeklyRetro } from "@/hooks/useRetro";
import BriefingSection from "./BriefingSection";

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + "T12:00:00");
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)}–${fmt(end)}`;
}

function DeltaBadge({ current, prior }: { current: number; prior: number }) {
  const delta = current - prior;
  if (delta === 0) return null;
  const isUp = delta > 0;
  return (
    <span
      className={`text-xs font-medium ${isUp ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
    >
      {isUp ? "↑" : "↓"} {Math.abs(delta)}
    </span>
  );
}

function StatCell({
  label,
  value,
  prior,
}: {
  label: string;
  value: number;
  prior?: number;
}) {
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3 text-center">
      <div className="text-lg font-semibold text-[var(--text-primary)]">
        {value}
        {prior !== undefined && (
          <span className="ml-1.5">
            <DeltaBadge current={value} prior={prior} />
          </span>
        )}
      </div>
      <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );
}

export default function RetroView() {
  const { data, isLoading } = useWeeklyRetro();

  if (isLoading) {
    return (
      <div className="max-w-[640px] mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--bg-elevated)] rounded w-48" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded w-full" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded w-3/4" />
        </div>
      </div>
    );
  }

  const retro = data?.retro;
  const weekStart = data?.weekStart || "";

  if (!retro) {
    return (
      <div className="max-w-[640px] mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-sm text-[var(--text-muted)]">
            Your weekly retrospective will appear here once you have some
            interactions logged.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[640px] mx-auto p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-lg font-medium text-[var(--text-primary)] tracking-tight">
          Week of {formatWeekRange(weekStart)}
        </h1>
        {retro.weekSummary && (
          <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            {retro.weekSummary}
          </p>
        )}
      </div>

      {/* Zen divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--amber)]/30 to-transparent" />

      {/* By the Numbers */}
      <BriefingSection title="By the Numbers" icon="📊">
        <div className="grid grid-cols-2 gap-2">
          <StatCell
            label="People"
            value={retro.stats.uniqueContacts}
            prior={retro.stats.priorWeekUniqueContacts}
          />
          <StatCell
            label="Interactions"
            value={retro.stats.totalInteractions}
            prior={retro.stats.priorWeekTotalInteractions}
          />
        </div>
      </BriefingSection>

      {/* Health Score */}
      <BriefingSection title="Health Score" icon="💓">
        <div className="bg-[var(--bg-elevated)] rounded-xl px-4 py-4 flex items-center justify-center gap-4">
          <div className="text-3xl font-bold text-[var(--text-primary)]">
            {retro.healthScore.current}
          </div>
          <div className="text-sm text-[var(--text-muted)]">
            <DeltaBadge
              current={retro.healthScore.current}
              prior={retro.healthScore.priorWeek}
            />
            <span className="ml-1.5">vs last week ({retro.healthScore.priorWeek})</span>
          </div>
        </div>
      </BriefingSection>

      {/* Rising */}
      {retro.risingContacts.length > 0 && (
        <BriefingSection title="Rising" icon="🔥">
          <div className="space-y-2">
            {retro.risingContacts.map((c) => (
              <div
                key={c.contactId}
                className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl px-4 py-3"
              >
                <div className="w-2 h-2 rounded-full bg-[var(--success)] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {c.name}
                  </span>
                </div>
                <span className="text-xs text-[var(--success)]">
                  {Math.round(c.tempBefore * 100)}→{Math.round(c.tempAfter * 100)}
                </span>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Cooling */}
      {retro.fallingContacts.length > 0 && (
        <BriefingSection title="Cooling" icon="❄️">
          <div className="space-y-2">
            {retro.fallingContacts.map((c) => (
              <div
                key={c.contactId}
                className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl px-4 py-3"
              >
                <div className="w-2 h-2 rounded-full bg-[var(--danger)]/60 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {c.name}
                  </span>
                </div>
                <span className="text-xs text-[var(--danger)]">
                  {Math.round(c.tempBefore * 100)}→{Math.round(c.tempAfter * 100)}
                </span>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Highlights */}
      {retro.topMoments.length > 0 && (
        <BriefingSection title="Highlights" icon="⭐">
          <div className="space-y-2">
            {retro.topMoments.map((m, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-1 rounded-full bg-[var(--amber)]/40 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    {m.name}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                    {m.summary}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Streaks */}
      {retro.streaks.length > 0 && (
        <BriefingSection title="Streaks" icon="🔥">
          <div className="space-y-2">
            {retro.streaks.map((s) => (
              <div
                key={s.contactId}
                className="flex items-center justify-between bg-[var(--bg-elevated)] rounded-xl px-4 py-3"
              >
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {s.name}
                </span>
                <span className="text-xs bg-[var(--amber-ghost-bg)] text-[var(--amber)] px-2 py-0.5 rounded-full font-medium">
                  {s.weeks}w streak
                </span>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Patterns */}
      {retro.patternsReinforced.length > 0 && (
        <BriefingSection title="Patterns" icon="🔄">
          <div className="space-y-2">
            {retro.patternsReinforced.map((p, i) => (
              <div key={i} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {p}
                </p>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}

      {/* Next Week */}
      {retro.nextWeekPreview.length > 0 && (
        <BriefingSection title="Next Week" icon="📅">
          <div className="space-y-2">
            {retro.nextWeekPreview.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl px-4 py-3"
              >
                <div className="w-1 rounded-full bg-[var(--border-medium)] flex-shrink-0 h-4" />
                <span className="text-sm text-[var(--text-secondary)]">{item}</span>
              </div>
            ))}
          </div>
        </BriefingSection>
      )}
    </div>
  );
}
