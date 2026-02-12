"use client";

import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
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

export interface ForceGraphHandle {
  triggerWarmthBurst: (nodeId: string) => void;
}

const ForceGraph = forwardRef<ForceGraphHandle, ForceGraphProps>(function ForceGraph({ data, onNodeClick }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [dpr, setDpr] = useState(1);
  // Shared viewport transform ref for focus mode (renderer writes, interaction reads)
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });

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

  // Force simulation — runs in CSS pixel space
  const { nodesRef, simulationRef, updateNodes } = useForceSimulation({
    width: dimensions.width,
    height: dimensions.height,
  });

  // Interaction
  const { hoveredNodeId, selectedNodeId, setSelectedNodeId, tooltip } =
    useGraphInteraction({
      canvasRef,
      nodesRef,
      simulationRef,
      viewportRef,
      onNodeClick: useCallback(
        (node: GraphNode | null) => {
          onNodeClick(node);
        },
        [onNodeClick]
      ),
    });

  // Canvas renderer
  const { drawFrame, triggerWarmthBurst } = useCanvasRenderer({
    canvasRef,
    nodesRef,
    hoveredNodeId,
    selectedNodeId,
    width: dimensions.width,
    height: dimensions.height,
    dpr,
    viewportRef,
  });

  // Expose triggerWarmthBurst to parent via ref
  useImperativeHandle(ref, () => ({
    triggerWarmthBurst,
  }), [triggerWarmthBurst]);

  // Continuous RAF rendering loop — manually tick physics then draw
  const drawFrameRef = useRef(drawFrame);
  drawFrameRef.current = drawFrame;

  useEffect(() => {
    let animationId: number;
    const loop = () => {
      simulationRef.current?.tick();
      drawFrameRef.current();
      animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationId);
  }, [simulationRef]);

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
});

export default ForceGraph;
