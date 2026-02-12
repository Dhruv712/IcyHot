"use client";

interface HealthScoreProps {
  score: number;
  contactCount: number;
}

export default function HealthScore({ score, contactCount }: HealthScoreProps) {
  const color =
    score >= 70
      ? "text-emerald-400"
      : score >= 40
        ? "text-yellow-400"
        : "text-red-400";

  const ringColor =
    score >= 70
      ? "stroke-emerald-400"
      : score >= 40
        ? "stroke-yellow-400"
        : "stroke-red-400";

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

  // SVG ring animation
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  if (contactCount === 0) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <span>Add people to see your network health</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Circular progress ring */}
      <div className="relative w-10 h-10">
        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
          {/* Background ring */}
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-gray-800"
          />
          {/* Progress ring */}
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={ringColor}
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${color}`}
        >
          {score}
        </span>
      </div>
      <div className="hidden sm:block">
        <div className={`text-sm font-semibold ${color}`}>{label}</div>
        <div className="text-[10px] text-gray-500">
          {contactCount} {contactCount === 1 ? "person" : "people"}
        </div>
      </div>
    </div>
  );
}
