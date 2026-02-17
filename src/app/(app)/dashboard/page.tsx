"use client";

import { useGraphData } from "@/hooks/useGraphData";
import { useCalendarStatus } from "@/hooks/useCalendar";
import HealthCard from "@/components/dashboard/HealthCard";
import StatsRow from "@/components/dashboard/StatsRow";
import OpenLoopsCard from "@/components/dashboard/OpenLoopsCard";
import ReachOutCard from "@/components/dashboard/ReachOutCard";
import NudgesCard from "@/components/dashboard/NudgesCard";
import InsightCard from "@/components/dashboard/InsightCard";
import NewPeopleCard from "@/components/dashboard/NewPeopleCard";
import UnmatchedCard from "@/components/dashboard/UnmatchedCard";

export default function DashboardPage() {
  const { data: graphData, isLoading } = useGraphData();
  const { data: calendarStatus } = useCalendarStatus();

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
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        {/* Health + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <HealthCard
            score={graphData?.healthScore ?? 0}
            contactCount={contactNodes.length}
          />
          <StatsRow nodes={contactNodes} />
        </div>

        {/* Open Loops (full width) */}
        <OpenLoopsCard />

        {/* Reach Outs + Nudges */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ReachOutCard />
          <NudgesCard nodes={contactNodes} />
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

        {/* Reflections + New People */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <InsightCard
            category="personal_reflection"
            title="Reflections"
            icon="💭"
            emptyMsg="No personal reflections yet."
            italic
          />
          <NewPeopleCard />
        </div>

        {/* Unmatched events */}
        <UnmatchedCard
          calendarConnected={!!calendarStatus?.connected}
          contacts={contactNodes.map((n) => ({ id: n.id, name: n.name }))}
        />
      </div>
    </div>
  );
}
