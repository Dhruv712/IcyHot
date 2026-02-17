"use client";

import { useState, useCallback, useRef } from "react";
import ForceGraph from "@/components/graph/ForceGraph";
import type { ForceGraphHandle } from "@/components/graph/ForceGraph";
import ContactPanel from "@/components/ContactPanel";
import DailyReachOut from "@/components/DailyReachOut";
import QuickLogButton from "@/components/QuickLogButton";
import { useGraphData } from "@/hooks/useGraphData";
import type { GraphNode } from "@/components/graph/types";

export default function GraphPage() {
  const { data: graphData, isLoading } = useGraphData();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const graphRef = useRef<ForceGraphHandle>(null);

  const handleWarmthBurst = useCallback((nodeId: string) => {
    graphRef.current?.triggerWarmthBurst(nodeId);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  const contactNodes = graphData?.nodes ?? [];

  return (
    <div className="h-full w-full relative">
      {/* Daily Reach Out Banner */}
      <DailyReachOut
        nodes={contactNodes}
        onNodeSelect={handleNodeClick}
        onInteractionLogged={handleWarmthBurst}
      />

      {/* Graph */}
      {isLoading ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-[var(--text-muted)]">Loading your network...</div>
        </div>
      ) : (
        <ForceGraph ref={graphRef} data={graphData ?? null} onNodeClick={handleNodeClick} />
      )}

      {/* Contact Panel (sidebar) */}
      {selectedNode && (
        <ContactPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onInteractionLogged={handleWarmthBurst}
        />
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
