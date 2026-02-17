"use client";

import Link from "next/link";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import { useJournalInsights } from "@/hooks/useJournal";

interface InsightCardProps {
  category: string;
  title: string;
  icon: string;
  emptyMsg: string;
  italic?: boolean;
}

export default function InsightCard({ category, title, icon, emptyMsg, italic }: InsightCardProps) {
  const { data: insights, isLoading } = useJournalInsights(category);

  if (isLoading) return null;
  if (!insights?.length) {
    return (
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle icon={icon}>{title}</CardTitle>
        </CardHeader>
        <p className="text-sm text-[var(--text-muted)]">{emptyMsg}</p>
      </Card>
    );
  }

  const displayCount = 3;
  const hasMore = insights.length > displayCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={icon}>{title}</CardTitle>
        <span className="text-xs text-[var(--text-muted)]">{insights.length}</span>
      </CardHeader>
      <div className="space-y-2.5">
        {insights.slice(0, displayCount).map((insight) => (
          <div key={insight.id} className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
            <div className="text-sm text-[var(--text-primary)] leading-relaxed">
              {italic ? (
                <span className="italic">&ldquo;{insight.content}&rdquo;</span>
              ) : (
                insight.content
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>{insight.entryDate}</span>
              {insight.contactName && (
                <span className="bg-[var(--bg-card)] px-2 py-0.5 rounded-lg">
                  {insight.contactName}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <Link
          href={`/insights?category=${category}`}
          className="mt-3 block text-center text-xs text-[var(--amber)] hover:text-[var(--amber-hover)] transition-colors py-1"
        >
          View all {insights.length} &rarr;
        </Link>
      )}
    </Card>
  );
}
