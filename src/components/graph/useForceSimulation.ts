"use client";

import { useRef, useEffect, useCallback } from "react";
import {
  forceSimulation,
  forceCollide,
  type Simulation,
} from "d3-force";
import type { GraphNode } from "./types";
import { temperatureBand, getOrbitRadii } from "@/lib/physics";

interface UseForceSimulationOptions {
  width: number;
  height: number;
}

/**
 * Sort nodes within an orbit so that group members are adjacent.
 *
 * Algorithm: greedy cluster walk.
 * 1. Pick the first node alphabetically as the starting point.
 * 2. Place it, then greedily pick the next unplaced node that shares
 *    the most groups with the current node (ties broken by name).
 * 3. Repeat until all nodes are placed.
 *
 * This guarantees group members cluster together on the ring while
 * keeping a deterministic, stable ordering.
 */
function sortByGroupProximity(nodes: GraphNode[]): GraphNode[] {
  if (nodes.length <= 1) return nodes;

  // Start with alphabetical sort so the seed is deterministic
  const remaining = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  const result: GraphNode[] = [];

  // Seed: first node alphabetically
  result.push(remaining.shift()!);

  while (remaining.length > 0) {
    const current = result[result.length - 1];
    const currentGroups = new Set(current.groupIds);

    // Find the remaining node with the most shared groups
    let bestIdx = 0;
    let bestShared = -1;

    for (let i = 0; i < remaining.length; i++) {
      const shared = remaining[i].groupIds.filter((g) => currentGroups.has(g)).length;
      if (
        shared > bestShared ||
        (shared === bestShared && remaining[i].name.localeCompare(remaining[bestIdx].name) < 0)
      ) {
        bestShared = shared;
        bestIdx = i;
      }
    }

    result.push(remaining.splice(bestIdx, 1)[0]);
  }

  return result;
}

export function useForceSimulation({
  width,
  height,
}: UseForceSimulationOptions) {
  const simulationRef = useRef<Simulation<GraphNode, undefined> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);

  // Store center coords and size in refs so callbacks stay stable
  const centerRef = useRef({ x: width / 2, y: height / 2 });
  centerRef.current = { x: width / 2, y: height / 2 };
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  // Stable updateNodes — never recreated, reads center + size from refs
  const updateNodes = useCallback((newNodes: GraphNode[]) => {
    const cx = centerRef.current.x;
    const cy = centerRef.current.y;
    const { width: w, height: h } = sizeRef.current;
    const orbitRadii = getOrbitRadii(w, h);

    // Create "Me" center node — all values in CSS pixels, no DPR scaling
    const meNode: GraphNode = {
      id: "me",
      name: "Me",
      email: null,
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
      hasCalendarEvents: false,
      x: cx,
      y: cy,
      fx: cx,
      fy: cy,
    };

    // Bucket nodes by orbit band
    const orbitBuckets = new Map<number, GraphNode[]>();
    for (const node of newNodes) {
      const band = temperatureBand(node.temperature);
      const bucket = orbitBuckets.get(band) || [];
      bucket.push(node);
      orbitBuckets.set(band, bucket);
    }

    // Assign fixed positions: evenly spaced around each orbit,
    // sorted so group members are adjacent
    const mergedNodes: GraphNode[] = [meNode];

    for (const [band, bucket] of orbitBuckets) {
      const sorted = sortByGroupProximity(bucket);
      const radius = orbitRadii[band];
      const count = sorted.length;

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2; // Start from top
        const targetX = cx + Math.cos(angle) * radius;
        const targetY = cy + Math.sin(angle) * radius;

        mergedNodes.push({
          ...sorted[i],
          x: targetX,
          y: targetY,
          fx: targetX,
          fy: targetY,
        });
      }
    }

    nodesRef.current = mergedNodes;

    if (simulationRef.current) {
      simulationRef.current.nodes(mergedNodes);
      simulationRef.current.alpha(0.3).restart();
    }
  }, []); // Stable — uses refs, never recreated

  // Create simulation ONCE on mount — only collision for label/hover sizing
  useEffect(() => {
    const sim = forceSimulation<GraphNode>(nodesRef.current)
      .force(
        "collide",
        forceCollide<GraphNode>()
          .radius((d) => d.nodeRadius + 4)
          .strength(0.5)
      )
      .alphaDecay(0.02)
      .alphaTarget(0)
      .velocityDecay(0.6)
      .on("tick", () => {}); // Ensure d3 starts its internal timer

    simulationRef.current = sim;

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update fixed positions when dimensions change
  const centerX = width / 2;
  const centerY = height / 2;

  useEffect(() => {
    const cx = centerX;
    const cy = centerY;
    const orbitRadii = getOrbitRadii(width, height);

    // Recompute fixed positions for all non-me nodes
    const orbitBuckets = new Map<number, GraphNode[]>();
    for (const node of nodesRef.current) {
      if (node.id === "me") continue;
      const band = temperatureBand(node.temperature);
      const bucket = orbitBuckets.get(band) || [];
      bucket.push(node);
      orbitBuckets.set(band, bucket);
    }

    // Update "me" node
    const meNode = nodesRef.current.find((n) => n.id === "me");
    if (meNode) {
      meNode.x = cx;
      meNode.y = cy;
      meNode.fx = cx;
      meNode.fy = cy;
    }

    // Update all orbit nodes
    for (const [band, bucket] of orbitBuckets) {
      const sorted = sortByGroupProximity(bucket);
      const radius = orbitRadii[band];
      const count = sorted.length;

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const targetX = cx + Math.cos(angle) * radius;
        const targetY = cy + Math.sin(angle) * radius;
        sorted[i].x = targetX;
        sorted[i].y = targetY;
        sorted[i].fx = targetX;
        sorted[i].fy = targetY;
      }
    }

    if (simulationRef.current) {
      simulationRef.current.alpha(0.1).restart();
    }
  }, [centerX, centerY, width, height]);

  return { nodesRef, simulationRef, updateNodes };
}
