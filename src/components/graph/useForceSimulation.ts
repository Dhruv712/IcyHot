"use client";

import { useRef, useEffect, useCallback } from "react";
import {
  forceSimulation,
  forceRadial,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import type { GraphNode } from "./types";

interface UseForceSimulationOptions {
  width: number;
  height: number;
  onTick: () => void;
}

export function useForceSimulation({
  width,
  height,
  onTick,
}: UseForceSimulationOptions) {
  const simulationRef = useRef<Simulation<GraphNode, undefined> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const centerX = width / 2;
  const centerY = height / 2;

  const updateNodes = useCallback(
    (newNodes: GraphNode[]) => {
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

      // Merge positions into new nodes
      const meNode: GraphNode = {
        id: "me",
        name: "Me",
        temperature: 1,
        importance: 10,
        orbitalRadius: 0,
        nodeRadius: 24,
        color: "#f5f5f5",
        mass: 10,
        groupId: null,
        groupAngle: null,
        lastInteraction: null,
        nudgeScore: 0,
        interactionCount: 0,
        relationshipType: "other",
        x: centerX,
        y: centerY,
        fx: centerX,
        fy: centerY,
      };

      const mergedNodes = [meNode, ...newNodes].map((node) => {
        const existing = existingPositions.get(node.id);
        if (existing && node.id !== "me") {
          return { ...node, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy };
        }
        if (node.id !== "me" && node.x === undefined) {
          // Place new nodes at a random position near their orbit
          const angle = Math.random() * Math.PI * 2;
          return {
            ...node,
            x: centerX + Math.cos(angle) * node.orbitalRadius,
            y: centerY + Math.sin(angle) * node.orbitalRadius,
          };
        }
        return node;
      });

      nodesRef.current = mergedNodes;

      if (simulationRef.current) {
        simulationRef.current.nodes(mergedNodes);
        simulationRef.current.alpha(0.3).restart();
      }
    },
    [centerX, centerY]
  );

  useEffect(() => {
    const sim = forceSimulation<GraphNode>(nodesRef.current)
      .force(
        "radial",
        forceRadial<GraphNode>(
          (d) => (d.id === "me" ? 0 : d.orbitalRadius),
          centerX,
          centerY
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
      .force(
        "groupCluster",
        groupClusterForce(centerX, centerY, 0.02)
      )
      .alphaDecay(0.005)
      .alphaTarget(0.02)
      .velocityDecay(0.3)
      .on("tick", () => onTickRef.current());

    simulationRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [centerX, centerY]);

  // Update forces when dimensions change
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

    // Update the "me" node position
    const meNode = nodesRef.current.find((n) => n.id === "me");
    if (meNode) {
      meNode.fx = centerX;
      meNode.fy = centerY;
    }

    sim
      .force("groupCluster", groupClusterForce(centerX, centerY, 0.02))
      .alpha(0.3)
      .restart();
  }, [centerX, centerY]);

  return { nodesRef, simulationRef, updateNodes };
}

function groupClusterForce(
  centerX: number,
  centerY: number,
  strength: number = 0.02
) {
  let nodes: GraphNode[];

  const force = (alpha: number) => {
    for (const node of nodes) {
      if (!node.groupAngle || node.id === "me") continue;
      const targetX =
        centerX + Math.cos(node.groupAngle) * node.orbitalRadius;
      const targetY =
        centerY + Math.sin(node.groupAngle) * node.orbitalRadius;
      node.vx! += (targetX - node.x!) * strength * alpha;
      node.vy! += (targetY - node.y!) * strength * alpha;
    }
  };

  force.initialize = (n: GraphNode[]) => {
    nodes = n;
  };

  return force;
}
