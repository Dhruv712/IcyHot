"use client";

import Card from "@/components/ui/Card";
import type { GraphNode } from "@/components/graph/types";

interface StatsRowProps {
  nodes: GraphNode[];
}

export default function StatsRow({ nodes }: StatsRowProps) {
  const totalPeople = nodes.length;
  const avgTemp = nodes.length > 0
    ? Math.round(nodes.reduce((sum, n) => sum + n.temperature, 0) / nodes.length * 100)
    : 0;

  // Interactions this week (count nodes with lastInteraction in past 7 days)
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentContacts = nodes.filter(
    (n) => n.lastInteraction && new Date(n.lastInteraction).getTime() > oneWeekAgo
  ).length;

  const stats = [
    { label: "People", value: totalPeople, icon: "👤" },
    { label: "Active this week", value: recentContacts, icon: "💬" },
    { label: "Avg warmth", value: `${avgTemp}%`, icon: "🔥" },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} padding="md">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">{stat.icon}</span>
            <span className="text-xs text-[var(--text-muted)]">{stat.label}</span>
          </div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">{stat.value}</div>
        </Card>
      ))}
    </div>
  );
}
