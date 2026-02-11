"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { drag } from "d3-drag";
import { select } from "d3-selection";
import type { Simulation } from "d3-force";
import type { GraphNode } from "./types";

interface UseGraphInteractionOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  nodesRef: React.RefObject<GraphNode[]>;
  simulationRef: React.RefObject<Simulation<GraphNode, undefined> | null>;
  dpr: number;
  onNodeClick: (node: GraphNode | null) => void;
}

export function useGraphInteraction({
  canvasRef,
  nodesRef,
  simulationRef,
  dpr,
  onNodeClick,
}: UseGraphInteractionOptions) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  const getNodeAtPoint = useCallback(
    (mx: number, my: number): GraphNode | null => {
      const nodes = nodesRef.current;
      // Iterate in reverse for z-order (top nodes first)
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const dx = mx - (node.x ?? 0);
        const dy = my - (node.y ?? 0);
        const hitRadius = node.nodeRadius + 4;
        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          return node;
        }
      }
      return null;
    },
    [nodesRef]
  );

  // Handle hover + tooltip
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * dpr;
      const my = (e.clientY - rect.top) * dpr;
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
  }, [canvasRef, dpr, getNodeAtPoint]);

  // Handle drag
  useEffect(() => {
    const canvas = canvasRef.current;
    const sim = simulationRef.current;
    if (!canvas || !sim) return;

    let draggedNode: GraphNode | null = null;

    const d3Drag = drag<HTMLCanvasElement, unknown>()
      .subject((event) => {
        const mx = event.x * dpr;
        const my = event.y * dpr;
        const node = getNodeAtPoint(mx, my);
        if (node && node.id !== "me") {
          return node;
        }
        return null;
      })
      .on("start", (event) => {
        if (!event.subject) return;
        draggedNode = event.subject as GraphNode;
        sim.alphaTarget(0.1).restart();
        draggedNode.fx = draggedNode.x;
        draggedNode.fy = draggedNode.y;
      })
      .on("drag", (event) => {
        if (!draggedNode) return;
        draggedNode.fx = event.x * dpr;
        draggedNode.fy = event.y * dpr;
      })
      .on("end", (event) => {
        if (!draggedNode) return;
        sim.alphaTarget(0.02);
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode = null;
      });

    select(canvas).call(d3Drag as never);

    return () => {
      select(canvas).on(".drag", null);
    };
  }, [canvasRef, simulationRef, dpr, getNodeAtPoint]);

  // Handle click
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * dpr;
      const my = (e.clientY - rect.top) * dpr;
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
  }, [canvasRef, dpr, getNodeAtPoint, onNodeClick]);

  return { hoveredNodeId, selectedNodeId, setSelectedNodeId, tooltip };
}
