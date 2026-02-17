"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { useJournalInsights } from "@/hooks/useJournal";

const CATEGORIES: Record<string, { title: string; icon: string; italic?: boolean }> = {
  recurring_theme: { title: "Recurring Themes", icon: "🔄" },
  relationship_dynamic: { title: "Relationship Dynamics", icon: "🤝" },
  personal_reflection: { title: "Reflections", icon: "💭", italic: true },
};

function InsightsContent() {
  const searchParams = useSearchParams();
  const category = searchParams.get("category") || "recurring_theme";
  const config = CATEGORIES[category] || CATEGORIES.recurring_theme;
  const { data: insights, isLoading } = useJournalInsights(category);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors mb-4 inline-flex items-center gap-1"
        >
          &larr; Dashboard
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            {config.icon} {config.title}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {insights?.length ?? 0} {(insights?.length ?? 0) === 1 ? "insight" : "insights"} from your journal
          </p>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 mb-6">
          {Object.entries(CATEGORIES).map(([key, cat]) => (
            <Link
              key={key}
              href={`/insights?category=${key}`}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                key === category
                  ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {cat.icon} {cat.title}
            </Link>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-12 text-[var(--text-muted)] text-sm">Loading...</div>
        ) : !insights?.length ? (
          <div className="text-center py-12 text-[var(--text-muted)] text-sm">
            No {config.title.toLowerCase()} yet.
          </div>
        ) : (
          <div className="space-y-3">
            {insights.map((insight) => (
              <div key={insight.id} className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-5 py-4">
                <div className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {config.italic ? (
                    <span className="italic">&ldquo;{insight.content}&rdquo;</span>
                  ) : (
                    insight.content
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>{insight.entryDate}</span>
                  {insight.contactName && (
                    <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-lg">
                      {insight.contactName}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    }>
      <InsightsContent />
    </Suspense>
  );
}
