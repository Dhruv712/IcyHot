"use client";

import Card, { CardHeader, CardTitle } from "@/components/ui/Card";

interface HealthCardProps {
  score: number;
  contactCount: number;
}

export default function HealthCard({ score, contactCount }: HealthCardProps) {
  const color =
    score >= 70 ? "var(--success)" : score >= 40 ? "var(--amber)" : "var(--danger)";

  const label =
    score >= 80
      ? "Thriving"
      : score >= 60
        ? "Healthy"
        : score >= 40
          ? "Cooling"
          : score >= 20
            ? "Neglected"
            : "Frozen";

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Network Health</CardTitle>
      </CardHeader>
      <div className="flex items-center gap-6">
        {/* Large circular gauge */}
        <div className="relative w-32 h-32 flex-shrink-0">
          <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60" cy="60" r={radius}
              fill="none" stroke="var(--border-medium)" strokeWidth="6"
            />
            <circle
              cx="60" cy="60" r={radius}
              fill="none" strokeWidth="6" strokeLinecap="round"
              stroke={color}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              style={{ transition: "stroke-dashoffset 1s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold" style={{ color }}>{score}</span>
            <span className="text-xs" style={{ color }}>{label}</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-sm text-[var(--text-secondary)]">
            {contactCount} {contactCount === 1 ? "person" : "people"} in your network
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Based on how regularly you interact with important connections
          </div>
        </div>
      </div>
    </Card>
  );
}
