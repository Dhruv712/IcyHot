"use client";

import { useRef, useEffect, useCallback } from "react";
import {
  forceSimulation,
  forceRadial,
  forceManyBody,
  forceCollide,
  type Simulation,
} from "d3-force";
import type { GraphNode } from "./types";

interface UseForceSimulationOptions {
  width: number;
  height: number;
}

export function useForceSimulation({
  width,
  height,
}: UseForceSimulationOptions) {
  const simulationRef = useRef<Simulation<GraphNode, undefined> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);

  // Store center coords in a ref so callbacks stay stable
  const centerRef = useRef({ x: width / 2, y: height / 2 });
  centerRef.current = { x: width / 2, y: height / 2 };

  // Stable updateNodes — never recreated, reads center from ref
  const updateNodes = useCallback((newNodes: GraphNode[]) => {
    const cx = centerRef.current.x;
    const cy = centerRef.current.y;

    // Preserve positions of existing nodes
    const existingPositions = new Map<
      string,
      { x: number; y: number; vx: number; vy: number }
    >();
    for (const node of nodesRef.current) {
      if (node.x !== undefined && node.y !== undefined) {
        existingPositions.set(node.id, {
          x: node.x,
          y: node.y,
          vx: node.vx ?? 0,
          vy: node.vy ?? 0,
        });
      }
    }

    // Create "Me" center node — all values in CSS pixels, no DPR scaling
    const meNode: GraphNode = {
      id: "me",
      name: "Me",
      temperature: 1,
      importance: 10,
      orbitalRadius: 0,
      nodeRadius: 32,
      color: "#f5f5f5",
      mass: 10,
      groupIds: [],
      groupAngle: null,
      lastInteraction: null,
      nudgeScore: 0,
      interactionCount: 0,
      relationshipType: "other",
      x: cx,
      y: cy,
      fx: cx,
      fy: cy,
    };

    // No DPR scaling — simulation runs in CSS pixel space
    const mergedNodes = [meNode, ...newNodes].map((node) => {
      const existing = existingPositions.get(node.id);
      if (existing && node.id !== "me") {
        return {
          ...node,
          x: existing.x,
          y: existing.y,
          vx: existing.vx,
          vy: existing.vy,
        };
      }
      if (node.id !== "me" && node.x === undefined) {
        const angle = Math.random() * Math.PI * 2;
        return {
          ...node,
          x: cx + Math.cos(angle) * node.orbitalRadius,
          y: cy + Math.sin(angle) * node.orbitalRadius,
        };
      }
      return node;
    });

    nodesRef.current = mergedNodes;

    if (simulationRef.current) {
      simulationRef.current.nodes(mergedNodes);
      simulationRef.current.alpha(0.3).restart();
    }
  }, []); // Stable — uses refs, never recreated

  // Create simulation ONCE on mount
  useEffect(() => {
    const cx = centerRef.current.x;
    const cy = centerRef.current.y;

    const sim = forceSimulation<GraphNode>(nodesRef.current)
      .force(
        "radial",
        forceRadial<GraphNode>(
          (d) => (d.id === "me" ? 0 : d.orbitalRadius),
          cx,
          cy
        ).strength(0.08)
      )
      .force(
        "charge",
        forceManyBody<GraphNode>().strength((d) =>
          d.id === "me" ? 0 : -20 - d.importance * 3
        )
      )
      .force(
        "collide",
        forceCollide<GraphNode>()
          .radius((d) => d.nodeRadius + 4)
          .strength(0.7)
      )
      .force("groupCluster", groupClusterForce(centerRef, 0.02))
      .alphaDecay(0.005)
      .alphaTarget(0.02)
      .velocityDecay(0.3)
      .on("tick", () => {}); // Ensure d3 starts its internal timer

    simulationRef.current = sim;

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update forces when dimensions change (without recreating simulation)
  const centerX = width / 2;
  const centerY = height / 2;

  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim) return;

    sim.force(
      "radial",
      forceRadial<GraphNode>(
        (d) => (d.id === "me" ? 0 : d.orbitalRadius),
        centerX,
        centerY
      ).strength(0.08)
    );

    sim.force("groupCluster", groupClusterForce(centerRef, 0.02));

    // Update the "me" node position
    const meNode = nodesRef.current.find((n) => n.id === "me");
    if (meNode) {
      meNode.fx = centerX;
      meNode.fy = centerY;
    }

    sim.alpha(0.3).restart();
  }, [centerX, centerY]);

  return { nodesRef, simulationRef, updateNodes };
}

function groupClusterForce(
  centerRef: React.RefObject<{ x: number; y: number }>,
  strength: number = 0.02
) {
  let nodes: GraphNode[];

  const force = (alpha: number) => {
    const cx = centerRef.current.x;
    const cy = centerRef.current.y;
    for (const node of nodes) {
      if (!node.groupAngle || node.id === "me") continue;
      const targetX = cx + Math.cos(node.groupAngle) * node.orbitalRadius;
      const targetY = cy + Math.sin(node.groupAngle) * node.orbitalRadius;
      node.vx! += (targetX - node.x!) * strength * alpha;
      node.vy! += (targetY - node.y!) * strength * alpha;
    }
  };

  force.initialize = (n: GraphNode[]) => {
    nodes = n;
  };

  return force;
}
