"use client";

import { useState, useMemo } from "react";
import { useMemorySearch, useMemoryStats } from "@/hooks/useMemory";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";

// ── Connection type labels ────────────────────────────────────────────

const CONNECTION_LABELS: Record<string, string> = {
  causal: "Causal",
  thematic: "Thematic",
  contradiction: "Contradiction",
  pattern: "Pattern",
  temporal_sequence: "Sequence",
  cross_domain: "Cross-domain",
  sensory: "Sensory",
  deviation: "Deviation",
  escalation: "Escalation",
};

const IMPLICATION_LABELS: Record<string, string> = {
  predictive: "Predictive",
  emotional: "Emotional",
  relational: "Relational",
  identity: "Identity",
  behavioral: "Behavioral",
  actionable: "Actionable",
  absence: "Absence",
  trajectory: "Trajectory",
  meta_cognitive: "Meta-cognitive",
  retrograde: "Retrograde",
  counterfactual: "Counterfactual",
};

// ── Stats Bar ─────────────────────────────────────────────────────────

function StatsBar() {
  const { data: stats, isLoading } = useMemoryStats();

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-4 animate-pulse">
            <div className="h-6 w-12 bg-[var(--bg-elevated)] rounded mb-1" />
            <div className="h-3 w-20 bg-[var(--bg-elevated)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  const statItems = [
    { value: stats.memories.total, label: "Memories", sub: `${stats.memories.avgStrength.toFixed(2)} avg strength` },
    { value: stats.connections.total, label: "Connections", sub: `${stats.connections.avgWeight.toFixed(2)} avg weight` },
    { value: stats.implications.total, label: "Implications", sub: `${stats.implications.avgStrength.toFixed(2)} avg strength` },
    { value: stats.recentlyActive, label: "Active (7d)", sub: `${((stats.recentlyActive / Math.max(stats.memories.total, 1)) * 100).toFixed(0)}% of total` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {statItems.map((item) => (
        <div key={item.label} className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{item.value}</div>
          <div className="text-xs text-[var(--text-secondary)] font-medium">{item.label}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Type Breakdown ────────────────────────────────────────────────────

function TypeBreakdown() {
  const { data: stats } = useMemoryStats();

  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Connection types */}
      {stats.connections.byType.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle icon="🔗">Connection Types</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {stats.connections.byType.map((ct) => (
              <div key={ct.type} className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">
                  {CONNECTION_LABELS[ct.type] || ct.type}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--amber)] rounded-full"
                      style={{ width: `${(ct.count / Math.max(...stats.connections.byType.map((t) => t.count))) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-muted)] w-6 text-right">{ct.count}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Implication types */}
      {stats.implications.byType.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle icon="💡">Implication Types</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {stats.implications.byType.map((it, idx) => (
              <div key={`${it.type}-${it.order}-${idx}`} className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">
                  {IMPLICATION_LABELS[it.type] || it.type}
                  {it.order > 1 && (
                    <span className="text-[var(--text-muted)] ml-1">({ordinal(it.order)})</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--amber)] rounded-full"
                      style={{ width: `${(it.count / Math.max(...stats.implications.byType.map((t) => t.count))) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-muted)] w-6 text-right">{it.count}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Search Results ────────────────────────────────────────────────────

function SearchResults({ query }: { query: string }) {
  const { data, isLoading, error } = useMemorySearch(query);

  if (query.length <= 2) {
    return (
      <div className="text-center py-8 text-[var(--text-muted)] text-sm">
        Type at least 3 characters to search your memory graph
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-8 text-[var(--text-muted)] text-sm">
        Searching memories...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-[var(--danger)] text-sm">
        Search failed. Try again.
      </div>
    );
  }

  if (!data || data.memories.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--text-muted)] text-sm">
        No memories found for &ldquo;{query}&rdquo;
      </div>
    );
  }

  const hopCounts = { 0: 0, 1: 0, 2: 0 };
  data.memories.forEach((m) => {
    if (m.hop in hopCounts) hopCounts[m.hop as keyof typeof hopCounts]++;
  });

  return (
    <div className="space-y-4">
      {/* Result summary */}
      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
        <span>{data.memories.length} memories</span>
        <span className="text-[var(--border-medium)]">|</span>
        <span>{data.implications.length} implications</span>
        <span className="text-[var(--border-medium)]">|</span>
        <span>{data.connections.length} connections</span>
        {(hopCounts[1] > 0 || hopCounts[2] > 0) && (
          <>
            <span className="text-[var(--border-medium)]">|</span>
            <span>
              {hopCounts[0]} direct
              {hopCounts[1] > 0 && `, ${hopCounts[1]} hop-1`}
              {hopCounts[2] > 0 && `, ${hopCounts[2]} hop-2`}
            </span>
          </>
        )}
      </div>

      {/* Implications (show first — they're the highest-value signal) */}
      {data.implications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle icon="💡">Implications</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {data.implications.map((impl) => (
              <div key={impl.id} className="border-l-2 border-[var(--amber)] pl-3">
                <div className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {impl.content}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {impl.implicationType && (
                    <span className="text-[10px] bg-[var(--amber-ghost-bg)] text-[var(--amber)] px-2 py-0.5 rounded-lg">
                      {IMPLICATION_LABELS[impl.implicationType] || impl.implicationType}
                    </span>
                  )}
                  {impl.implicationOrder && impl.implicationOrder > 1 && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {ordinal(impl.implicationOrder)} order
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--text-muted)]">
                    strength: {impl.strength.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Connections */}
      {data.connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle icon="🔗">Connections</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {data.connections.map((conn, idx) => {
              const memA = data.memories.find((m) => m.id === conn.fromId);
              const memB = data.memories.find((m) => m.id === conn.toId);
              return (
                <div key={`${conn.fromId}-${conn.toId}-${idx}`} className="border-l-2 border-[var(--text-muted)] pl-3">
                  {conn.reason && (
                    <div className="text-sm text-[var(--text-primary)] leading-relaxed mb-1.5">
                      {conn.reason}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {conn.connectionType && (
                      <span className="text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] px-2 py-0.5 rounded-lg">
                        {CONNECTION_LABELS[conn.connectionType] || conn.connectionType}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--text-muted)]">
                      weight: {conn.weight.toFixed(2)}
                    </span>
                  </div>
                  {(memA || memB) && (
                    <div className="mt-1.5 space-y-1">
                      {memA && (
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          → {memA.content.slice(0, 100)}
                        </div>
                      )}
                      {memB && (
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          → {memB.content.slice(0, 100)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Memories */}
      <div className="space-y-2">
        {data.memories.map((memory) => (
          <div
            key={memory.id}
            className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-5 py-4"
          >
            <div className="text-sm text-[var(--text-primary)] leading-relaxed">
              {memory.content}
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-[var(--text-muted)]">
              <span>{memory.sourceDate}</span>
              <span className="text-[var(--border-medium)]">|</span>
              <span>
                score: {memory.activationScore.toFixed(3)}
              </span>
              <span className="text-[var(--border-medium)]">|</span>
              <span>
                strength: {memory.strength.toFixed(2)}
              </span>
              {memory.hop > 0 && (
                <span className="bg-[var(--amber-ghost-bg)] text-[var(--amber)] px-2 py-0.5 rounded-lg font-medium">
                  hop {memory.hop}
                </span>
              )}
              {(memory as { viaImplication?: string }).viaImplication && (
                <span className="bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-lg font-medium">
                  via implication
                </span>
              )}
            </div>
            {(memory as { viaImplication?: string }).viaImplication && (
              <div className="mt-1.5 text-[11px] text-purple-400/70 italic leading-relaxed">
                Bridged by: {(memory as { viaImplication?: string }).viaImplication!.slice(0, 120)}
                {(memory as { viaImplication?: string }).viaImplication!.length > 120 ? "..." : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top Connected Memories ────────────────────────────────────────────

function TopConnected() {
  const { data: stats } = useMemoryStats();

  if (!stats?.topConnectedMemories?.length) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle icon="🕸️">Most Connected Memories</CardTitle>
      </CardHeader>
      <div className="space-y-3">
        {stats.topConnectedMemories.map((m) => (
          <div key={m.id} className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--amber-ghost-bg)] text-[var(--amber)] flex items-center justify-center text-xs font-bold">
              {m.connectionCount}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--text-primary)] leading-relaxed line-clamp-2">
                {m.content}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                {m.sourceDate} · strength {m.strength.toFixed(2)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Page ──────────────────────────────────────────────────────────────

export default function MemoryPage() {
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<"search" | "explore">("explore");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            🧠 Memory
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Your personal knowledge graph — memories, connections, and implications
          </p>
        </div>

        {/* Stats */}
        <StatsBar />

        {/* View toggle */}
        <div className="flex gap-1 mb-6">
          <button
            onClick={() => setActiveView("explore")}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              activeView === "explore"
                ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            Explore
          </button>
          <button
            onClick={() => setActiveView("search")}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              activeView === "search"
                ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            Search
          </button>
        </div>

        {activeView === "search" ? (
          <>
            {/* Search input */}
            <div className="relative mb-6">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your memories (e.g., a person, place, topic, feeling...)"
                className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] transition-colors"
              />
            </div>

            <SearchResults query={query} />
          </>
        ) : (
          <>
            <TopConnected />
            <TypeBreakdown />
          </>
        )}
      </div>
    </div>
  );
}
