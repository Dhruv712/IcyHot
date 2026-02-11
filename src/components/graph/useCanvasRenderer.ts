"use client";

import { useRef, useEffect, useCallback } from "react";
import { drawNodes } from "./nodeRenderer";
import type { GraphNode } from "./types";

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface UseCanvasRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  nodesRef: React.RefObject<GraphNode[]>;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  width: number;
  height: number;
  dpr: number;
}

export function useCanvasRenderer({
  canvasRef,
  nodesRef,
  hoveredNodeId,
  selectedNodeId,
  width,
  height,
  dpr,
}: UseCanvasRendererOptions) {
  const starsRef = useRef<Star[]>([]);

  // Generate starfield when dimensions change
  useEffect(() => {
    const cw = width * dpr;
    const ch = height * dpr;
    const count = Math.min(200, Math.floor((cw * ch) / 6000));
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * cw,
        y: Math.random() * ch,
        size: (Math.random() * 1.2 + 0.4) * dpr,
        opacity: Math.random() * 0.4 + 0.1,
        twinkleSpeed: Math.random() * 0.002 + 0.001,
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }
    starsRef.current = stars;
  }, [width, height, dpr]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = width * dpr;
    const ch = height * dpr;
    const now = performance.now();

    ctx.clearRect(0, 0, cw, ch);

    // Dark background
    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, 0, cw, ch);

    // Subtle radial gradient from center
    const centerX = cw / 2;
    const centerY = ch / 2;
    const bgGradient = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(cw, ch) * 0.5
    );
    bgGradient.addColorStop(0, "rgba(20, 20, 40, 0.8)");
    bgGradient.addColorStop(1, "transparent");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, cw, ch);

    // Draw twinkling starfield
    for (const star of starsRef.current) {
      const twinkle =
        Math.sin(now * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7;
      ctx.globalAlpha = star.opacity * twinkle;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw faint orbital rings with subtle pulse
    const ringPulse = Math.sin(now * 0.0008) * 0.01 + 0.03;
    const rings = [150 * dpr, 300 * dpr, 500 * dpr, 750 * dpr];
    ctx.strokeStyle = `rgba(255, 255, 255, ${ringPulse})`;
    ctx.lineWidth = 1;
    for (const r of rings) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw nodes
    drawNodes(ctx, nodesRef.current, hoveredNodeId, selectedNodeId, dpr, now);
  }, [canvasRef, nodesRef, hoveredNodeId, selectedNodeId, width, height, dpr]);

  return { drawFrame };
}
