"use client";

import { useRef, useEffect, useCallback } from "react";
import { drawNodes } from "./nodeRenderer";
import type { GraphNode } from "./types";
import { getOrbitRadii, temperatureBand } from "@/lib/physics";

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface WarmthBurst {
  nodeId: string;
  startTime: number;
  duration: number;
  color: string;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

interface UseCanvasRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  nodesRef: React.RefObject<GraphNode[]>;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  width: number;
  height: number;
  dpr: number;
  viewportRef: React.RefObject<ViewportTransform>;
}

export function useCanvasRenderer({
  canvasRef,
  nodesRef,
  hoveredNodeId,
  selectedNodeId,
  width,
  height,
  dpr,
  viewportRef,
}: UseCanvasRendererOptions) {
  const starsRef = useRef<Star[]>([]);
  const burstsRef = useRef<WarmthBurst[]>([]);

  // Trigger a warmth burst animation on a node
  const triggerWarmthBurst = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    burstsRef.current.push({
      nodeId,
      startTime: performance.now(),
      duration: 1500,
      color: node?.color ?? "rgb(239,68,68)",
    });
  }, [nodesRef]);

  // Generate starfield in CSS pixel space
  useEffect(() => {
    const count = Math.min(120, Math.floor((width * height) / 10000));
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.2 + 0.4,
        opacity: Math.random() * 0.4 + 0.1,
        twinkleSpeed: Math.random() * 0.002 + 0.001,
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }
    starsRef.current = stars;
  }, [width, height]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = performance.now();

    // Clear in device pixels, then scale so all drawing uses CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Dark background — warm undertone
    ctx.fillStyle = "#191919";
    ctx.fillRect(0, 0, width, height);

    // Subtle warm amber radial gradient from center
    const centerX = width / 2;
    const centerY = height / 2;
    const bgGradient = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(width, height) * 0.5
    );
    bgGradient.addColorStop(0, "rgba(212, 168, 83, 0.03)");
    bgGradient.addColorStop(1, "transparent");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // --- Focus mode: compute & lerp viewport transform ---
    const nodes = nodesRef.current;
    const viewport = viewportRef.current;
    const LERP_SPEED = 0.06; // smooth ~16 frames to converge
    const isFocused = selectedNodeId !== null;

    if (selectedNodeId) {
      const focusNode = nodes.find((n) => n.id === selectedNodeId);
      const meNode = nodes.find((n) => n.id === "me");
      if (focusNode && meNode) {
        // Target: midpoint between Me and focused node, zoom 1.8x
        const midX = ((meNode.x ?? centerX) + (focusNode.x ?? centerX)) / 2;
        const midY = ((meNode.y ?? centerY) + (focusNode.y ?? centerY)) / 2;
        const targetScale = 1.8;
        const targetX = centerX - midX * targetScale;
        const targetY = centerY - midY * targetScale;
        viewport.x += (targetX - viewport.x) * LERP_SPEED;
        viewport.y += (targetY - viewport.y) * LERP_SPEED;
        viewport.scale += (targetScale - viewport.scale) * LERP_SPEED;
      }
    } else {
      // Lerp back to identity
      viewport.x += (0 - viewport.x) * LERP_SPEED;
      viewport.y += (0 - viewport.y) * LERP_SPEED;
      viewport.scale += (1 - viewport.scale) * LERP_SPEED;
      // Snap when close enough to avoid perpetual micro-lerp
      if (Math.abs(viewport.scale - 1) < 0.001) {
        viewport.x = 0;
        viewport.y = 0;
        viewport.scale = 1;
      }
    }

    // Draw twinkling starfield
    for (const star of starsRef.current) {
      const twinkle =
        Math.sin(now * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7;
      ctx.globalAlpha = star.opacity * twinkle;
      ctx.fillStyle = "#f5f0e8";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Apply viewport transform (on top of DPR transform) after background/starfield
    if (viewport.scale !== 1 || viewport.x !== 0 || viewport.y !== 0) {
      ctx.setTransform(
        dpr * viewport.scale, 0,
        0, dpr * viewport.scale,
        viewport.x * dpr,
        viewport.y * dpr
      );
    }

    // Draw orbital rings at quantized temperature bands (CSS pixels)
    const orbitRadii = getOrbitRadii(width, height);
    const ringPulse = Math.sin(now * 0.0008) * 0.01 + 0.03;
    const bandLabels = ["Hot", "Warm", "Cool", "Cold"];

    // Count drifting nodes per orbital band
    const driftingPerBand = [0, 0, 0, 0];
    for (const node of nodesRef.current) {
      if (node.id === "me") continue;
      if (node.importance >= 7 && node.temperature < 0.3) {
        driftingPerBand[temperatureBand(node.temperature)]++;
      }
    }

    if (isFocused) ctx.globalAlpha = 0.3;
    for (let i = 0; i < orbitRadii.length; i++) {
      const r = orbitRadii[i];
      // Inner rings slightly brighter
      const ringAlpha = ringPulse * (1.0 - i * 0.15);
      ctx.strokeStyle = `rgba(212, 168, 83, ${ringAlpha})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Band label (top of ring)
      if (!isFocused) {
        ctx.fillStyle = `rgba(212, 168, 83, ${0.12 - i * 0.02})`;
        ctx.font = "9px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        let label = bandLabels[i];
        if (driftingPerBand[i] > 0) {
          label += ` · ${driftingPerBand[i]} drifting`;
        }
        ctx.fillText(label, centerX, centerY - r - 4);
      }
    }
    ctx.globalAlpha = 1;

    // Draw nodes (all in CSS pixel space) — pass focusedNodeId for dimming
    drawNodes(ctx, nodesRef.current, hoveredNodeId, selectedNodeId, now, selectedNodeId);

    // Draw warmth burst animations (expanding rings + glow)
    const activeBursts = burstsRef.current.filter(
      (b) => now - b.startTime < b.duration
    );
    burstsRef.current = activeBursts;

    for (const burst of activeBursts) {
      const node = nodesRef.current.find((n) => n.id === burst.nodeId);
      if (!node || node.x === undefined || node.y === undefined) continue;

      const elapsed = now - burst.startTime;
      const progress = elapsed / burst.duration;
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic

      // Expanding ring
      const maxRadius = node.nodeRadius * 4;
      const ringRadius = node.nodeRadius + eased * maxRadius;
      const ringAlpha = (1 - eased) * 0.6;

      ctx.strokeStyle = `rgba(255, 200, 100, ${ringAlpha})`;
      ctx.lineWidth = 2 * (1 - eased);
      ctx.beginPath();
      ctx.arc(node.x, node.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Second slower ring
      const ring2Progress = Math.max(0, (elapsed - 200) / burst.duration);
      if (ring2Progress > 0 && ring2Progress < 1) {
        const eased2 = 1 - Math.pow(1 - ring2Progress, 3);
        const ring2Radius = node.nodeRadius + eased2 * maxRadius * 0.7;
        const ring2Alpha = (1 - eased2) * 0.3;
        ctx.strokeStyle = `rgba(255, 255, 255, ${ring2Alpha})`;
        ctx.lineWidth = 1.5 * (1 - eased2);
        ctx.beginPath();
        ctx.arc(node.x, node.y, ring2Radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Core flash (bright white glow that fades)
      if (progress < 0.4) {
        const flashAlpha = (1 - progress / 0.4) * 0.4;
        const flashGradient = ctx.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          node.nodeRadius * 2
        );
        flashGradient.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha})`);
        flashGradient.addColorStop(1, "transparent");
        ctx.fillStyle = flashGradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.nodeRadius * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [canvasRef, nodesRef, hoveredNodeId, selectedNodeId, width, height, dpr]);

  return { drawFrame, triggerWarmthBurst };
}
