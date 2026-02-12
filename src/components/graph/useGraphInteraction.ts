"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { drag } from "d3-drag";
import { select } from "d3-selection";
import type { Simulation } from "d3-force";
import type { GraphNode } from "./types";

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

interface UseGraphInteractionOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  nodesRef: React.RefObject<GraphNode[]>;
  simulationRef: React.RefObject<Simulation<GraphNode, undefined> | null>;
  viewportRef: React.RefObject<ViewportTransform>;
  onNodeClick: (node: GraphNode | null) => void;
}

export function useGraphInteraction({
  canvasRef,
  nodesRef,
  simulationRef,
  viewportRef,
  onNodeClick,
}: UseGraphInteractionOptions) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  // Convert screen (CSS pixel) coordinates to world coordinates
  // accounting for the focus mode viewport transform
  const screenToWorld = useCallback(
    (sx: number, sy: number): [number, number] => {
      const vp = viewportRef.current;
      return [(sx - vp.x) / vp.scale, (sy - vp.y) / vp.scale];
    },
    [viewportRef]
  );

  const getNodeAtPoint = useCallback(
    (mx: number, my: number): GraphNode | null => {
      const [wx, wy] = screenToWorld(mx, my);
      const nodes = nodesRef.current;
      // Iterate in reverse for z-order (top nodes first)
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const dx = wx - (node.x ?? 0);
        const dy = wy - (node.y ?? 0);
        const hitRadius = node.nodeRadius + 4;
        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          return node;
        }
      }
      return null;
    },
    [nodesRef, screenToWorld]
  );

  // Handle hover + tooltip
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = getNodeAtPoint(mx, my);

      setHoveredNodeId(node?.id ?? null);
      canvas.style.cursor = node && node.id !== "me" ? "pointer" : "default";

      if (node && node.id !== "me") {
        setTooltip({ x: e.clientX, y: e.clientY, node });
      } else {
        setTooltip(null);
      }
    };

    const handleMouseLeave = () => {
      setHoveredNodeId(null);
      setTooltip(null);
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [canvasRef, getNodeAtPoint]);

  // Handle drag — read simulationRef.current inside callbacks (not at setup)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let draggedNode: GraphNode | null = null;

    const d3Drag = drag<HTMLCanvasElement, unknown>()
      .subject((event) => {
        const mx = event.x;
        const my = event.y;
        const node = getNodeAtPoint(mx, my);
        if (node && node.id !== "me") {
          return node;
        }
        return null;
      })
      .on("start", (event) => {
        if (!event.subject) return;
        draggedNode = event.subject as GraphNode;
        const sim = simulationRef.current;
        if (sim) sim.alphaTarget(0.1).restart();
        draggedNode.fx = draggedNode.x;
        draggedNode.fy = draggedNode.y;
      })
      .on("drag", (event) => {
        if (!draggedNode) return;
        // Transform screen coords to world coords for focus mode
        const vp = viewportRef.current;
        draggedNode.fx = (event.x - vp.x) / vp.scale;
        draggedNode.fy = (event.y - vp.y) / vp.scale;
      })
      .on("end", () => {
        if (!draggedNode) return;
        const sim = simulationRef.current;
        if (sim) sim.alphaTarget(0.02).alpha(0.5).restart();
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode = null;
      });

    select(canvas).call(d3Drag as never);

    return () => {
      select(canvas).on(".drag", null);
    };
  }, [canvasRef, simulationRef, viewportRef, getNodeAtPoint]);

  // Handle click
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = getNodeAtPoint(mx, my);

      if (node && node.id !== "me") {
        setSelectedNodeId(node.id);
        onNodeClick(node);
      } else {
        setSelectedNodeId(null);
        onNodeClick(null);
      }
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [canvasRef, getNodeAtPoint, onNodeClick]);

  // Handle Escape key to unfocus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        onNodeClick(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNodeClick]);

  return { hoveredNodeId, selectedNodeId, setSelectedNodeId, tooltip };
}
