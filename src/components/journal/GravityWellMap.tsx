"use client";

import { useRef, useEffect, useCallback } from "react";
import type { ClusterNode, MemoryDot } from "@/hooks/useGravityWell";

const SOURCE_COLORS: Record<string, string> = {
  journal: "rgb(245, 158, 11)",
  calendar: "rgb(96, 165, 250)",
  interaction: "rgb(74, 222, 128)",
};

const LERP_SPEED = 0.06;
const BREATHING_SPEED = 0.002;
const PULSE_DECAY = 0.97;

interface GravityWellMapProps {
  clusters: ClusterNode[];
  memoryDots: MemoryDot[];
  currentPosition: { x: number; y: number } | null;
  trail: Array<{ x: number; y: number }>;
  width: number;
  height: number;
}

export default function GravityWellMap({
  clusters,
  memoryDots,
  currentPosition,
  trail,
  width,
  height,
}: GravityWellMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lerpPosRef = useRef<{ x: number; y: number } | null>(null);
  const clusterPulseRef = useRef<Map<number, number>>(new Map());
  const timeRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    timeRef.current += 1;

    // ── HiDPI setup ──
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // ── Background ──
    ctx.fillStyle = "rgb(10, 10, 15)";
    ctx.fillRect(0, 0, width, height);

    const PAD = 20; // px padding from edges
    const drawW = width - PAD * 2;
    const drawH = height - PAD * 2;

    function toScreenX(nx: number): number {
      return PAD + nx * drawW;
    }
    function toScreenY(ny: number): number {
      return PAD + ny * drawH;
    }

    // ── Memory dots (starfield) ──
    for (const dot of memoryDots) {
      const sx = toScreenX(dot.x);
      const sy = toScreenY(dot.y);
      const color = SOURCE_COLORS[dot.source] || SOURCE_COLORS.journal;
      const alpha = 0.12 + dot.strength * 0.15;

      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = color
        .replace("rgb(", "rgba(")
        .replace(")", `, ${alpha})`);
      ctx.fill();
    }

    // ── Cluster nodes ──
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const cx = toScreenX(cluster.x);
      const cy = toScreenY(cluster.y);
      const radius = Math.max(8, Math.sqrt(cluster.memberCount) * 3);

      // Pulse effect when dot is nearby
      const pulse = clusterPulseRef.current.get(i) ?? 0;
      const borderAlpha = 0.3 + pulse * 0.5;

      // Glow
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(196, 149, 64, ${0.08 + pulse * 0.12})`;
      ctx.fill();

      // Border
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(196, 149, 64, ${borderAlpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + pulse * 0.25})`;
      ctx.fillText(cluster.label, cx, cy + radius + 12);

      // Decay pulse
      if (pulse > 0.01) {
        clusterPulseRef.current.set(i, pulse * PULSE_DECAY);
      } else {
        clusterPulseRef.current.delete(i);
      }
    }

    // ── Lerp current position ──
    if (currentPosition) {
      if (!lerpPosRef.current) {
        lerpPosRef.current = { ...currentPosition };
      } else {
        lerpPosRef.current.x +=
          (currentPosition.x - lerpPosRef.current.x) * LERP_SPEED;
        lerpPosRef.current.y +=
          (currentPosition.y - lerpPosRef.current.y) * LERP_SPEED;
      }

      // Check proximity to clusters → trigger pulse
      for (let i = 0; i < clusters.length; i++) {
        const dx = lerpPosRef.current.x - clusters[i].x;
        const dy = lerpPosRef.current.y - clusters[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clusterRadius = Math.sqrt(clusters[i].memberCount) * 3;
        const threshold = (clusterRadius / Math.min(drawW, drawH)) + 0.08;

        if (dist < threshold) {
          const current = clusterPulseRef.current.get(i) ?? 0;
          clusterPulseRef.current.set(i, Math.max(current, 0.8));
        }
      }
    }

    // ── Trail ──
    if (trail.length > 1) {
      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 1; i < trail.length; i++) {
        const progress = i / trail.length;
        const alpha = progress * 0.5;

        ctx.beginPath();
        ctx.moveTo(toScreenX(trail[i - 1].x), toScreenY(trail[i - 1].y));
        ctx.lineTo(toScreenX(trail[i].x), toScreenY(trail[i].y));
        ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
        ctx.stroke();
      }
    }

    // ── Current position dot ──
    if (lerpPosRef.current) {
      const sx = toScreenX(lerpPosRef.current.x);
      const sy = toScreenY(lerpPosRef.current.y);
      const breath =
        6 + Math.sin(timeRef.current * BREATHING_SPEED * Math.PI * 2) * 1.5;

      // Soft glow
      const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, breath * 3);
      gradient.addColorStop(0, "rgba(245, 158, 11, 0.3)");
      gradient.addColorStop(1, "rgba(245, 158, 11, 0)");
      ctx.beginPath();
      ctx.arc(sx, sy, breath * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(sx, sy, breath, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(245, 158, 11)";
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [clusters, memoryDots, currentPosition, trail, width, height]);

  // Setup canvas + start animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw, width, height]);

  // Reset lerp when position changes to null (entry switch)
  useEffect(() => {
    if (!currentPosition) {
      lerpPosRef.current = null;
    }
  }, [currentPosition]);

  if (clusters.length === 0 && memoryDots.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width, height }}
      >
        <p className="text-xs text-[var(--text-muted)] text-center px-4">
          Not enough memories yet.
          <br />
          Keep journaling!
        </p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, borderRadius: 6 }}
    />
  );
}
