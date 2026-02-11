"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useForceSimulation } from "./useForceSimulation";
import { useCanvasRenderer } from "./useCanvasRenderer";
import { useGraphInteraction } from "./useGraphInteraction";
import { temperatureLabel } from "@/lib/temperature";
import { formatDate } from "@/lib/utils";
import type { GraphNode, GraphData } from "./types";

interface ForceGraphProps {
  data: GraphData | null;
  onNodeClick: (node: GraphNode | null) => void;
}

export default function ForceGraph({ data, onNodeClick }: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [dpr, setDpr] = useState(1);

  // Measure container
  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);

    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // Force simulation
  const { nodesRef, simulationRef, updateNodes } = useForceSimulation({
    width: dimensions.width * dpr,
    height: dimensions.height * dpr,
    onTick: () => drawFrame(),
  });

  // Interaction
  const { hoveredNodeId, selectedNodeId, setSelectedNodeId, tooltip } =
    useGraphInteraction({
      canvasRef,
      nodesRef,
      simulationRef,
      dpr,
      onNodeClick: useCallback(
        (node: GraphNode | null) => {
          onNodeClick(node);
        },
        [onNodeClick]
      ),
    });

  // Canvas renderer
  const { drawFrame } = useCanvasRenderer({
    canvasRef,
    nodesRef,
    hoveredNodeId,
    selectedNodeId,
    width: dimensions.width,
    height: dimensions.height,
    dpr,
  });

  // Update nodes when data changes
  useEffect(() => {
    if (data?.nodes) {
      updateNodes(data.nodes as GraphNode[]);
    }
  }, [data, updateNodes]);

  // Set up canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
  }, [dimensions, dpr]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas ref={canvasRef} className="block" />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed pointer-events-none z-50 bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-xl"
          style={{
            left: tooltip.x + 16,
            top: tooltip.y - 10,
          }}
        >
          <div className="font-semibold text-white">{tooltip.node.name}</div>
          <div className="text-gray-400 text-xs mt-0.5">
            {temperatureLabel(tooltip.node.temperature)} &middot;{" "}
            {tooltip.node.lastInteraction
              ? `Last: ${formatDate(new Date(tooltip.node.lastInteraction))}`
              : "No interactions yet"}
          </div>
        </div>
      )}
    </div>
  );
}
