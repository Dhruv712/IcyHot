"use client";

import { useRef, useEffect, useCallback } from "react";
import {
  forceSimulation,
  forceCollide,
  type Simulation,
} from "d3-force";
import type { GraphNode } from "./types";
import { temperatureBand, getOrbitRadii, scaleNodeRadius } from "@/lib/physics";

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

/**
 * Enforce a per-orbit capacity cap. If a ring has more nodes than can
 * comfortably fit, push overflow to the next ring outward.
 *
 * Capacity = floor(circumference / minSpacing) where
 * minSpacing = 2 * avgScaledNodeRadius + 20px gap.
 *
 * Processes bands 0→3 (inner→outer). Band 3 absorbs all overflow.
 */
function applyOverflowCap(
  buckets: Map<number, GraphNode[]>,
  orbitRadii: number[]
): Map<number, GraphNode[]> {
  const result = new Map<number, GraphNode[]>();
  // Copy buckets so we don't mutate the input
  for (const [band, nodes] of buckets) {
    result.set(band, [...nodes]);
  }

  for (let band = 0; band < 3; band++) {
    const bucket = result.get(band);
    if (!bucket || bucket.length <= 1) continue;

    const radius = orbitRadii[band];
    const circumference = 2 * Math.PI * radius;

    // Average scaled node radius in this bucket
    const avgRadius =
      bucket.reduce((sum, n) => sum + n.nodeRadius, 0) / bucket.length;
    const minSpacing = 2 * avgRadius + 20;
    const capacity = Math.max(1, Math.floor(circumference / minSpacing));

    if (bucket.length > capacity) {
      // Sort by nudgeScore desc so the most important stay on this ring
      const sorted = [...bucket].sort((a, b) => b.nudgeScore - a.nudgeScore);
      const keep = sorted.slice(0, capacity);
      const overflow = sorted.slice(capacity);

      result.set(band, keep);

      // Push overflow to next band
      const nextBand = band + 1;
      const nextBucket = result.get(nextBand) || [];
      nextBucket.push(...overflow);
      result.set(nextBand, nextBucket);
    }
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
      baseNodeRadius: 32,
      nodeRadius: scaleNodeRadius(32, orbitRadii),
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

    // Bucket nodes by orbit band, applying viewport-scaled node radius
    const orbitBuckets = new Map<number, GraphNode[]>();
    for (const node of newNodes) {
      const band = temperatureBand(node.temperature);
      const bucket = orbitBuckets.get(band) || [];
      const base = node.baseNodeRadius ?? node.nodeRadius;
      bucket.push({
        ...node,
        baseNodeRadius: base,
        nodeRadius: scaleNodeRadius(base, orbitRadii),
      });
      orbitBuckets.set(band, bucket);
    }

    // Enforce per-orbit capacity cap — overflow to next ring outward
    const cappedBuckets = applyOverflowCap(orbitBuckets, orbitRadii);

    // Assign fixed positions: evenly spaced around each orbit,
    // sorted so group members are adjacent
    const mergedNodes: GraphNode[] = [meNode];

    for (const [band, bucket] of cappedBuckets) {
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
      if (node.id === "me") {
        // Update "me" node size + position
        node.nodeRadius = scaleNodeRadius(32, orbitRadii);
        node.x = cx;
        node.y = cy;
        node.fx = cx;
        node.fy = cy;
        continue;
      }
      // Re-scale node radius from base (avoids double-scaling)
      node.nodeRadius = scaleNodeRadius(node.baseNodeRadius, orbitRadii);
      const band = temperatureBand(node.temperature);
      const bucket = orbitBuckets.get(band) || [];
      bucket.push(node);
      orbitBuckets.set(band, bucket);
    }

    // Enforce per-orbit capacity cap
    const cappedBuckets = applyOverflowCap(orbitBuckets, orbitRadii);

    // Update all orbit nodes
    for (const [band, bucket] of cappedBuckets) {
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
