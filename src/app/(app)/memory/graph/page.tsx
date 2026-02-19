"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemoryGraph } from "@/hooks/useMemory";

// Dynamic import to avoid SSR for canvas component
const MemoryForceGraph = dynamic(
  () => import("@/components/memory-graph/MemoryForceGraph"),
  { ssr: false }
);

interface SelectedNode {
  id: string;
  content: string;
  fullContent: string;
  sourceDate: string;
  strength: number;
  activationCount: number;
  source: string;
  contactIds: string[];
  connectionCount: number;
}

export default function MemoryGraphPage() {
  const { data, isLoading, error } = useMemoryGraph();
  const [viewMode, setViewMode] = useState<"graph" | "semantic">("graph");
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const handleSelectNode = (node: SelectedNode | null) => {
    setSelectedNode(node);
    setPanelOpen(!!node);
  };

  // Find connected edges & implications for selected node
  const connectedEdges = selectedNode
    ? (data?.edges ?? []).filter(
        (e) => e.source === selectedNode.id || e.target === selectedNode.id
      )
    : [];

  const connectedNodeIds = new Set(
    connectedEdges.flatMap((e) => [
      typeof e.source === "string" ? e.source : e.source,
      typeof e.target === "string" ? e.target : e.target,
    ])
  );
  connectedNodeIds.delete(selectedNode?.id ?? "");

  const connectedNodes = (data?.nodes ?? []).filter((n) =>
    connectedNodeIds.has(n.id)
  );

  const relatedImplications = selectedNode
    ? (data?.implications ?? []).filter((impl) =>
        impl.sourceMemoryIds.includes(selectedNode.id)
      )
    : [];

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--text-muted)] text-sm">
          Loading memory graph...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--text-muted)] text-sm">
          Failed to load memory graph.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Link
            href="/memory"
            className="text-xs text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
          >
            &larr; Explorer
          </Link>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">
            Memory Graph
          </h1>
          <span className="text-xs text-[var(--text-muted)]">
            {data.nodes.length} memories &middot; {data.edges.length} connections
          </span>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-[var(--bg-elevated)] rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("graph")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              viewMode === "graph"
                ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            Force Graph
          </button>
          <button
            onClick={() => setViewMode("semantic")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              viewMode === "semantic"
                ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            Semantic Map
          </button>
        </div>
      </div>

      {/* Canvas area + side panel */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* Canvas */}
        <div
          className={`flex-1 transition-all duration-200 ${
            panelOpen ? "mr-0" : ""
          }`}
        >
          <MemoryForceGraph
            nodes={data.nodes}
            edges={data.edges}
            implications={data.implications}
            viewMode={viewMode}
            selectedNode={selectedNode as never}
            onSelectNode={handleSelectNode as never}
          />
        </div>

        {/* Side panel */}
        <div
          className={`absolute right-0 top-0 bottom-0 w-[340px] bg-[var(--bg-card)] border-l border-[var(--border-subtle)] overflow-y-auto transition-transform duration-200 z-20 ${
            panelOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {selectedNode && (
            <div className="p-4 space-y-4">
              {/* Close button */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Memory Detail
                </span>
                <button
                  onClick={() => {
                    setSelectedNode(null);
                    setPanelOpen(false);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="bg-[var(--bg-elevated)] rounded-xl px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {selectedNode.fullContent}
                </p>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Date
                  </div>
                  <div className="text-xs text-[var(--text-primary)] mt-0.5">
                    {selectedNode.sourceDate}
                  </div>
                </div>
                <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Source
                  </div>
                  <div className="text-xs text-[var(--text-primary)] mt-0.5 capitalize">
                    {selectedNode.source}
                  </div>
                </div>
                <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Strength
                  </div>
                  <div className="text-xs text-[var(--text-primary)] mt-0.5">
                    {selectedNode.strength.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Activations
                  </div>
                  <div className="text-xs text-[var(--text-primary)] mt-0.5">
                    {selectedNode.activationCount}
                  </div>
                </div>
              </div>

              {/* Connected memories */}
              {connectedNodes.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Connected Memories ({connectedNodes.length})
                  </h3>
                  <div className="space-y-2">
                    {connectedNodes.slice(0, 10).map((cn) => {
                      const edge = connectedEdges.find(
                        (e) =>
                          (e.source === cn.id &&
                            e.target === selectedNode.id) ||
                          (e.target === cn.id && e.source === selectedNode.id)
                      );
                      return (
                        <div
                          key={cn.id}
                          className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2 cursor-pointer hover:bg-[var(--bg-base)] transition-colors"
                          onClick={() => handleSelectNode(cn as SelectedNode)}
                        >
                          <div className="text-xs text-[var(--text-primary)] leading-relaxed line-clamp-2">
                            {cn.content}
                          </div>
                          {edge && (
                            <div className="mt-1 flex items-center gap-1.5">
                              {edge.connectionType && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] text-[var(--text-muted)]">
                                  {edge.connectionType.replace(/_/g, " ")}
                                </span>
                              )}
                              <span className="text-[10px] text-[var(--text-muted)]">
                                w: {edge.weight.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {edge?.reason && (
                            <div className="mt-1 text-[10px] text-[var(--text-muted)] italic line-clamp-2">
                              {edge.reason}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {connectedNodes.length > 10 && (
                      <div className="text-[10px] text-[var(--text-muted)] text-center py-1">
                        +{connectedNodes.length - 10} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Related implications */}
              {relatedImplications.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Implications ({relatedImplications.length})
                  </h3>
                  <div className="space-y-2">
                    {relatedImplications.map((impl) => (
                      <div
                        key={impl.id}
                        className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2 border-l-2 border-[var(--amber)]"
                      >
                        <div className="text-xs text-[var(--text-primary)] leading-relaxed">
                          {impl.content}
                        </div>
                        {impl.implicationType && (
                          <div className="mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--amber-ghost-bg)] text-[var(--amber)]">
                              {impl.implicationType.replace(/_/g, " ")}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  Legend
                </h3>
                <div className="flex flex-wrap gap-3 text-[10px] text-[var(--text-muted)]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "rgb(245, 158, 11)" }}
                    />
                    Journal
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "rgb(96, 165, 250)" }}
                    />
                    Calendar
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "rgb(74, 222, 128)" }}
                    />
                    Interaction
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
