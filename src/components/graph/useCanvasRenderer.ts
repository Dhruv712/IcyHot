"use client";

import { useRef, useEffect, useCallback } from "react";
import { drawNodes } from "./nodeRenderer";
import type { GraphNode } from "./types";

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
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width * dpr, height * dpr);

    // Dark background
    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, 0, width * dpr, height * dpr);

    // Subtle radial gradient from center
    const centerX = (width * dpr) / 2;
    const centerY = (height * dpr) / 2;
    const bgGradient = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(width, height) * dpr * 0.5
    );
    bgGradient.addColorStop(0, "rgba(20, 20, 40, 0.8)");
    bgGradient.addColorStop(1, "transparent");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width * dpr, height * dpr);

    // Draw faint orbital rings
    const rings = [150, 300, 500, 750];
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    for (const r of rings) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw nodes
    drawNodes(ctx, nodesRef.current, hoveredNodeId, selectedNodeId, dpr);
  }, [canvasRef, nodesRef, hoveredNodeId, selectedNodeId, width, height, dpr]);

  return { drawFrame };
}
