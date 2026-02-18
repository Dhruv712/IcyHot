"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useGraphData } from "@/hooks/useGraphData";
import { useGroups } from "@/hooks/useGroups";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import { RELATIONSHIP_LABELS } from "@/lib/constants";
import Badge from "@/components/ui/Badge";
import type { GraphNode } from "@/components/graph/types";

type SortKey = "name" | "temperature" | "lastInteraction" | "importance";

export default function ContactsPage() {
  const { data: graphData, isLoading } = useGraphData();
  const { data: groups } = useGroups();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("temperature");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterGroup, setFilterGroup] = useState<string>("all");

  const contactNodes = graphData?.nodes ?? [];

  const filtered = useMemo(() => {
    let result = [...contactNodes];

    // Search
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((n) => n.name.toLowerCase().includes(lower));
    }

    // Filter by relationship type
    if (filterType !== "all") {
      result = result.filter((n) => n.relationshipType === filterType);
    }

    // Filter by group
    if (filterGroup !== "all") {
      result = result.filter((n) => n.groupIds.includes(filterGroup));
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "temperature":
          return b.temperature - a.temperature;
        case "lastInteraction": {
          const aTime = a.lastInteraction ? new Date(a.lastInteraction).getTime() : 0;
          const bTime = b.lastInteraction ? new Date(b.lastInteraction).getTime() : 0;
          return bTime - aTime;
        }
        case "importance":
          return b.importance - a.importance;
        default:
          return 0;
      }
    });

    return result;
  }, [contactNodes, search, sortBy, filterType, filterGroup]);

  const handleRowClick = (node: GraphNode) => {
    // Navigate to graph page with query param to select this node
    router.push(`/?select=${node.id}`);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">People</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {contactNodes.length} {contactNodes.length === 1 ? "person" : "people"} in your network
          </p>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="w-full md:flex-1 md:min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[var(--amber)] flex-shrink-0"
            >
              <option value="all">All types</option>
              {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {groups && groups.length > 0 && (
              <select
                value={filterGroup}
                onChange={(e) => setFilterGroup(e.target.value)}
                className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[var(--amber)] flex-shrink-0"
              >
                <option value="all">All groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[var(--amber)] flex-shrink-0"
            >
              <option value="name">Sort: Name</option>
              <option value="temperature">Sort: Temperature</option>
              <option value="lastInteraction">Sort: Last Contact</option>
              <option value="importance">Sort: Importance</option>
            </select>
          </div>
        </div>

        {/* Contact List */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-sm">
              {search ? "No people match your search" : "No people in your network yet"}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {filtered.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleRowClick(node)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--bg-elevated)] transition-colors text-left group"
                >
                  {/* Temperature dot */}
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: node.color }}
                  />

                  {/* Name + type */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {node.name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[var(--text-muted)]">
                        {RELATIONSHIP_LABELS[node.relationshipType] ?? node.relationshipType}
                      </span>
                      {node.groupIds.length > 0 && groups && (
                        <div className="flex items-center gap-1">
                          {node.groupIds.slice(0, 2).map((gId) => {
                            const group = groups.find((g) => g.id === gId);
                            return group ? (
                              <Badge key={gId} variant="amber">{group.name}</Badge>
                            ) : null;
                          })}
                          {node.groupIds.length > 2 && (
                            <Badge variant="muted">+{node.groupIds.length - 2}</Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Temperature */}
                  <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-[var(--border-medium)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${node.temperature * 100}%`,
                            backgroundColor: node.color,
                          }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-14 text-right">
                        {temperatureLabel(node.temperature)}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {node.lastInteraction
                        ? formatDate(new Date(node.lastInteraction))
                        : "Never"}
                    </span>
                  </div>

                  {/* Arrow */}
                  <svg
                    className="hidden md:block w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--amber)] transition-colors flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
