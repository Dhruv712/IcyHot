"use client";

import { useState } from "react";
import { useGraphData } from "@/hooks/useGraphData";
import { useCalendarStatus } from "@/hooks/useCalendar";
import BriefingView from "@/components/dashboard/BriefingView";
import HealthCard from "@/components/dashboard/HealthCard";
import StatsRow from "@/components/dashboard/StatsRow";
import ReachOutCard from "@/components/dashboard/ReachOutCard";
import NudgesCard from "@/components/dashboard/NudgesCard";
import InsightCard from "@/components/dashboard/InsightCard";
import NewPeopleCard from "@/components/dashboard/NewPeopleCard";
import UnmatchedCard from "@/components/dashboard/UnmatchedCard";

export default function DashboardPage() {
  const { data: graphData, isLoading } = useGraphData();
  const { data: calendarStatus } = useCalendarStatus();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const contactNodes = graphData?.nodes ?? [];

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Morning Briefing — primary view */}
      <BriefingView />

      {/* Reach Out (always visible below briefing) */}
      <div className="max-w-[640px] mx-auto px-6 pb-4">
        <ReachOutCard />
      </div>

      {/* Zen divider before details */}
      <div className="max-w-[640px] mx-auto px-6 py-2">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-medium)] to-transparent" />
      </div>

      {/* Collapsible Details */}
      <div className="max-w-4xl mx-auto px-6 pb-8">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="flex items-center gap-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors py-2 mb-3"
        >
          <svg
            className={`w-3 h-3 transition-transform ${detailsOpen ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="uppercase tracking-widest font-semibold">Details</span>
        </button>

        {detailsOpen && (
          <div className="space-y-5 animate-in">
            {/* Health + Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <HealthCard
                score={graphData?.healthScore ?? 0}
                contactCount={contactNodes.length}
              />
              <StatsRow nodes={contactNodes} />
            </div>

            {/* Reach Outs + Nudges */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <NudgesCard nodes={contactNodes} />
              <NewPeopleCard />
            </div>

            {/* Themes + Dynamics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <InsightCard
                category="recurring_theme"
                title="Recurring Themes"
                icon="🔄"
                emptyMsg="No recurring themes yet. Sync your journal to see patterns."
              />
              <InsightCard
                category="relationship_dynamic"
                title="Relationship Dynamics"
                icon="🤝"
                emptyMsg="No relationship dynamics yet."
              />
            </div>

            {/* Reflections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <InsightCard
                category="personal_reflection"
                title="Reflections"
                icon="💭"
                emptyMsg="No personal reflections yet."
                italic
              />
            </div>

            {/* Unmatched events */}
            <UnmatchedCard
              calendarConnected={!!calendarStatus?.connected}
              contacts={contactNodes.map((n) => ({ id: n.id, name: n.name }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
