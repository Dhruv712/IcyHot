"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ForceGraph from "@/components/graph/ForceGraph";
import type { ForceGraphHandle } from "@/components/graph/ForceGraph";
import ContactPanel from "@/components/ContactPanel";
import QuickLogButton from "@/components/QuickLogButton";
import { useGraphData } from "@/hooks/useGraphData";
import type { GraphNode } from "@/components/graph/types";

export default function GraphPage() {
  const { data: graphData, isLoading } = useGraphData();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graphRef = useRef<ForceGraphHandle>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectId = searchParams.get("select");

  const contactNodes = useMemo(() => graphData?.nodes ?? [], [graphData?.nodes]);

  // Derive selectedNode from graphData so it always reflects the latest data
  const selectedNode = useMemo(
    () => (selectedNodeId ? contactNodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, contactNodes]
  );

  // Auto-select node when navigating from contacts page with ?select=nodeId
  useEffect(() => {
    if (selectId && contactNodes.length > 0) {
      const node = contactNodes.find((n) => n.id === selectId);
      if (node) {
        setTimeout(() => setSelectedNodeId(node.id), 0);
      }
      router.replace("/", { scroll: false });
    }
  }, [selectId, contactNodes, router]);

  const handleWarmthBurst = useCallback((nodeId: string) => {
    graphRef.current?.triggerWarmthBurst(nodeId);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNodeId(node?.id ?? null);
  }, []);

  return (
    <div className="h-full w-full relative">
      {/* Graph */}
      {isLoading ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-[var(--text-muted)]">Loading your network...</div>
        </div>
      ) : (
        <ForceGraph ref={graphRef} data={graphData ?? null} onNodeClick={handleNodeClick} />
      )}

      {/* Contact Panel (sidebar / mobile sheet) */}
      {selectedNode && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-30 md:hidden"
            onClick={() => setSelectedNodeId(null)}
          />
          <ContactPanel
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onInteractionLogged={handleWarmthBurst}
          />
        </>
      )}

      {/* Quick Log Button */}
      <QuickLogButton
        nodes={contactNodes}
        groups={graphData?.groups ?? []}
        onInteractionLogged={handleWarmthBurst}
      />
    </div>
  );
}
