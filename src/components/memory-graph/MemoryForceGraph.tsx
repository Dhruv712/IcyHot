"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationLinkDatum,
} from "d3-force";
import { drag as d3Drag } from "d3-drag";
import { select } from "d3-selection";

// ── Types ──────────────────────────────────────────────────────────────

interface MemNode {
  id: string;
  content: string;
  fullContent: string;
  sourceDate: string;
  strength: number;
  activationCount: number;
  source: string;
  contactIds: string[];
  connectionCount: number;
  ux: number;
  uy: number;
  // Runtime
  nodeRadius: number;
  color: string;
  // D3
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  // Lerp targets (for UMAP transition)
  targetX?: number;
  targetY?: number;
}

interface MemEdge extends SimulationLinkDatum<MemNode> {
  source: string | MemNode;
  target: string | MemNode;
  weight: number;
  connectionType: string | null;
  reason: string | null;
}

interface MemImplication {
  id: string;
  content: string;
  sourceMemoryIds: string[];
  implicationType: string | null;
}

interface Props {
  nodes: Array<{
    id: string;
    content: string;
    fullContent: string;
    sourceDate: string;
    strength: number;
    activationCount: number;
    source: string;
    contactIds: string[];
    connectionCount: number;
    ux: number;
    uy: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    connectionType: string | null;
    reason: string | null;
  }>;
  implications: MemImplication[];
  viewMode: "graph" | "semantic";
  selectedNode: MemNode | null;
  onSelectNode: (node: MemNode | null) => void;
}

// ── Constants ──────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  journal: "rgb(245, 158, 11)", // amber
  calendar: "rgb(96, 165, 250)", // blue
  interaction: "rgb(74, 222, 128)", // green
};

const CONNECTION_TYPE_COLORS: Record<string, string> = {
  causal: "rgba(245, 158, 11, 0.4)",
  thematic: "rgba(168, 162, 158, 0.3)",
  contradiction: "rgba(239, 68, 68, 0.35)",
  pattern: "rgba(168, 85, 247, 0.35)",
  temporal_sequence: "rgba(96, 165, 250, 0.3)",
  cross_domain: "rgba(74, 222, 128, 0.3)",
  sensory: "rgba(251, 191, 36, 0.3)",
  deviation: "rgba(239, 68, 68, 0.25)",
  escalation: "rgba(249, 115, 22, 0.35)",
};

const LERP_SPEED = 0.08;
const PADDING = 60;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.15;

// ── Component ──────────────────────────────────────────────────────────

export default function MemoryForceGraph({
  nodes: rawNodes,
  edges: rawEdges,
  implications,
  viewMode,
  selectedNode,
  onSelectNode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<MemNode, MemEdge> | null>(null);
  const nodesRef = useRef<MemNode[]>([]);
  const edgesRef = useRef<MemEdge[]>([]);
  const rafRef = useRef<number>(0);
  const hoveredRef = useRef<MemNode | null>(null);
  const selectedRef = useRef<MemNode | null>(null);
  const viewModeRef = useRef(viewMode);
  const isTransitioning = useRef(false);

  // Viewport (zoom/pan)
  const vpRef = useRef({ x: 0, y: 0, scale: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [dpr, setDpr] = useState(1);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: MemNode;
  } | null>(null);

  // Keep refs in sync
  selectedRef.current = selectedNode as MemNode | null;
  viewModeRef.current = viewMode;

  // ── Screen-to-world conversion ──────────────────────────────────────

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const vp = vpRef.current;
    return [(sx - vp.x) / vp.scale, (sy - vp.y) / vp.scale] as const;
  }, []);

  const worldToScreen = useCallback((wx: number, wy: number) => {
    const vp = vpRef.current;
    return [wx * vp.scale + vp.x, wy * vp.scale + vp.y] as const;
  }, []);

  // ── Resize observer ────────────────────────────────────────────────

  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Initialize nodes + simulation ──────────────────────────────────

  useEffect(() => {
    if (dimensions.width === 0 || rawNodes.length === 0) return;

    const { width, height } = dimensions;

    const nodes: MemNode[] = rawNodes.map((n) => {
      const baseRadius = Math.max(
        4,
        3 + n.connectionCount * 0.8 + n.strength * 2
      );
      return {
        ...n,
        nodeRadius: Math.min(baseRadius, 18),
        color: SOURCE_COLORS[n.source] || SOURCE_COLORS.journal,
        x: width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: height / 2 + (Math.random() - 0.5) * height * 0.6,
        targetX: undefined,
        targetY: undefined,
      };
    });

    const edges: MemEdge[] = rawEdges
      .filter(
        (e) =>
          nodes.some((n) => n.id === e.source) &&
          nodes.some((n) => n.id === e.target)
      )
      .map((e) => ({ ...e }));

    nodesRef.current = nodes;
    edgesRef.current = edges;

    const sim = forceSimulation<MemNode>(nodes)
      .force(
        "link",
        forceLink<MemNode, MemEdge>(edges)
          .id((d) => d.id)
          .distance(80)
          .strength((d) => (d as MemEdge).weight * 0.3)
      )
      .force("charge", forceManyBody().strength(-40))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<MemNode>((d) => d.nodeRadius + 2))
      .alphaDecay(0.015)
      .velocityDecay(0.55)
      .on("tick", () => {});

    simRef.current = sim;

    // Reset viewport on new data
    vpRef.current = { x: 0, y: 0, scale: 1 };

    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, rawEdges, dimensions.width, dimensions.height]);

  // ── Handle view mode changes ────────────────────────────────────────

  useEffect(() => {
    const nodes = nodesRef.current;
    const sim = simRef.current;
    if (!sim || nodes.length === 0 || dimensions.width === 0) return;

    const { width, height } = dimensions;

    if (viewMode === "semantic") {
      for (const node of nodes) {
        node.targetX = PADDING + node.ux * (width - 2 * PADDING);
        node.targetY = PADDING + node.uy * (height - 2 * PADDING);
      }
      sim.force("link", null);
      sim.force("charge", null);
      sim.force("center", null);
      sim.alpha(0.3).restart();
      isTransitioning.current = true;
    } else {
      const edges = edgesRef.current;
      sim
        .force(
          "link",
          forceLink<MemNode, MemEdge>(edges)
            .id((d) => d.id)
            .distance(80)
            .strength((d) => (d as MemEdge).weight * 0.3)
        )
        .force("charge", forceManyBody().strength(-40))
        .force("center", forceCenter(width / 2, height / 2));

      for (const node of nodes) {
        node.fx = null;
        node.fy = null;
        node.targetX = undefined;
        node.targetY = undefined;
      }
      sim.alpha(0.5).restart();
      isTransitioning.current = true;
    }

    // Reset viewport on mode change
    vpRef.current = { x: 0, y: 0, scale: 1 };
  }, [viewMode, dimensions]);

  // ── Hit test utility (viewport-aware) ────────────────────────────────

  const getNodeAtPoint = useCallback(
    (screenX: number, screenY: number): MemNode | null => {
      const [wx, wy] = screenToWorld(screenX, screenY);
      const nodes = nodesRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.x == null || n.y == null) continue;
        const dx = wx - n.x;
        const dy = wy - n.y;
        if (dx * dx + dy * dy < (n.nodeRadius + 4) ** 2) {
          return n;
        }
      }
      return null;
    },
    [screenToWorld]
  );

  // ── Mouse interactions (viewport-aware) ──────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Wheel → zoom toward cursor
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = vpRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 1 - ZOOM_STEP : 1 + ZOOM_STEP;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.scale * factor));

      // Zoom toward cursor: keep point under cursor stationary
      vp.x = mx - (mx - vp.x) * (newScale / vp.scale);
      vp.y = my - (my - vp.y) * (newScale / vp.scale);
      vp.scale = newScale;
    };

    // Mousedown → start pan if no node hit
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Left button only
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const node = getNodeAtPoint(mx, my);
      if (!node) {
        // Start panning
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          vpX: vpRef.current.x,
          vpY: vpRef.current.y,
        };
        canvas.style.cursor = "grabbing";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        vpRef.current.x = panStartRef.current.vpX + dx;
        vpRef.current.y = panStartRef.current.vpY + dy;
        setTooltip(null);
        return;
      }

      const node = getNodeAtPoint(mx, my);
      hoveredRef.current = node;
      canvas.style.cursor = node ? "pointer" : "grab";

      if (node && node.x != null && node.y != null) {
        const [sx, sy] = worldToScreen(node.x, node.y);
        setTooltip({ x: sx, y: sy, node });
      } else {
        setTooltip(null);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        canvas.style.cursor = "grab";
        // If mouse barely moved, treat as click on empty space → deselect
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          onSelectNode(null);
        }
        return;
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (isPanningRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = getNodeAtPoint(mx, my);

      if (node) {
        onSelectNode(node.id === selectedRef.current?.id ? null : node);
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("click", handleClick);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("click", handleClick);
    };
  }, [getNodeAtPoint, onSelectNode, worldToScreen]);

  // ── D3 drag (for nodes) ─────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dragHandler = d3Drag<HTMLCanvasElement, unknown>()
      .subject((event) => {
        const node = getNodeAtPoint(event.x, event.y);
        return node || undefined;
      })
      .on("start", (event) => {
        const sim = simRef.current;
        if (!sim) return;
        if (!event.active) sim.alphaTarget(0.1).restart();
        const node = event.subject as MemNode;
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event) => {
        const node = event.subject as MemNode;
        // Convert screen coords to world coords for drag
        const [wx, wy] = screenToWorld(event.x, event.y);
        node.fx = wx;
        node.fy = wy;
      })
      .on("end", (event) => {
        const sim = simRef.current;
        if (!sim) return;
        if (!event.active) sim.alphaTarget(0);
        const node = event.subject as MemNode;
        if (viewModeRef.current === "graph") {
          node.fx = null;
          node.fy = null;
        }
      });

    select(canvas).call(dragHandler);

    return () => {
      select(canvas).on(".drag", null);
    };
  }, [getNodeAtPoint, screenToWorld]);

  // ── Escape key ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectNode(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onSelectNode]);

  // ── Zoom helpers ────────────────────────────────────────────────────

  const zoomIn = useCallback(() => {
    const vp = vpRef.current;
    const { width, height } = dimensions;
    const cx = width / 2;
    const cy = height / 2;
    const newScale = Math.min(MAX_ZOOM, vp.scale * (1 + ZOOM_STEP));
    vp.x = cx - (cx - vp.x) * (newScale / vp.scale);
    vp.y = cy - (cy - vp.y) * (newScale / vp.scale);
    vp.scale = newScale;
  }, [dimensions]);

  const zoomOut = useCallback(() => {
    const vp = vpRef.current;
    const { width, height } = dimensions;
    const cx = width / 2;
    const cy = height / 2;
    const newScale = Math.max(MIN_ZOOM, vp.scale * (1 - ZOOM_STEP));
    vp.x = cx - (cx - vp.x) * (newScale / vp.scale);
    vp.y = cy - (cy - vp.y) * (newScale / vp.scale);
    vp.scale = newScale;
  }, [dimensions]);

  const resetView = useCallback(() => {
    vpRef.current = { x: 0, y: 0, scale: 1 };
  }, []);

  // ── RAF loop ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = dimensions.width + "px";
    canvas.style.height = dimensions.height + "px";

    const { width, height } = dimensions;

    function draw(time: number) {
      if (!ctx) return;
      const sim = simRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const selected = selectedRef.current;
      const hovered = hoveredRef.current;
      const currentMode = viewModeRef.current;
      const vp = vpRef.current;

      // Manual tick + UMAP lerp
      if (sim) {
        sim.tick();

        if (currentMode === "semantic") {
          let settled = true;
          for (const node of nodes) {
            if (node.targetX != null && node.targetY != null) {
              const dx = node.targetX - (node.x ?? 0);
              const dy = node.targetY - (node.y ?? 0);
              if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                settled = false;
              }
              node.x = (node.x ?? 0) + dx * LERP_SPEED;
              node.y = (node.y ?? 0) + dy * LERP_SPEED;
              node.fx = node.x;
              node.fy = node.y;
              node.vx = 0;
              node.vy = 0;
            }
          }
          if (settled) isTransitioning.current = false;
        }
      }

      // ── Clear + DPR transform ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // ── Background (always drawn at identity) ──
      ctx.fillStyle = "rgb(17, 17, 17)";
      ctx.fillRect(0, 0, width, height);

      // ── Apply viewport transform ──
      ctx.translate(vp.x, vp.y);
      ctx.scale(vp.scale, vp.scale);

      // Subtle grid in semantic mode
      if (currentMode === "semantic") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 0.5 / vp.scale;
        const gridSize = 60;
        for (let gx = PADDING; gx < width - PADDING; gx += gridSize) {
          ctx.beginPath();
          ctx.moveTo(gx, PADDING);
          ctx.lineTo(gx, height - PADDING);
          ctx.stroke();
        }
        for (let gy = PADDING; gy < height - PADDING; gy += gridSize) {
          ctx.beginPath();
          ctx.moveTo(PADDING, gy);
          ctx.lineTo(width - PADDING, gy);
          ctx.stroke();
        }
      }

      // ── Draw edges ──
      for (const edge of edges) {
        const s = edge.source as MemNode;
        const t = edge.target as MemNode;
        if (s.x == null || s.y == null || t.x == null || t.y == null) continue;

        const isHighlighted =
          selected && (s.id === selected.id || t.id === selected.id);

        const baseColor =
          CONNECTION_TYPE_COLORS[edge.connectionType ?? ""] ??
          "rgba(255, 255, 255, 0.08)";

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = isHighlighted
          ? baseColor.replace(/[\d.]+\)$/, "0.7)")
          : baseColor;
        ctx.lineWidth = (isHighlighted ? 1 + edge.weight * 2 : 0.5 + edge.weight) / vp.scale;
        ctx.stroke();
      }

      // ── Draw nodes ──
      const sorted = [...nodes].sort((a, b) => {
        if (a.id === selected?.id) return 1;
        if (b.id === selected?.id) return -1;
        if (a.id === hovered?.id) return 1;
        if (b.id === hovered?.id) return -1;
        return a.connectionCount - b.connectionCount;
      });

      for (const node of sorted) {
        if (node.x == null || node.y == null) continue;

        const isSelected = node.id === selected?.id;
        const isHovered = node.id === hovered?.id;
        const isConnectedToSelected =
          selected &&
          edges.some((e) => {
            const s = e.source as MemNode;
            const t = e.target as MemNode;
            return (
              (s.id === selected.id && t.id === node.id) ||
              (t.id === selected.id && s.id === node.id)
            );
          });

        const dimmed = selected && !isSelected && !isConnectedToSelected;
        ctx.globalAlpha = dimmed ? 0.15 : 1;

        const r = node.nodeRadius;

        // Glow for connected nodes
        if (node.connectionCount > 2 && !dimmed) {
          const breathe =
            Math.sin(time * 0.0012 + node.connectionCount * 0.3) * 0.06 + 0.94;
          const glowRadius =
            r * (1.5 + node.connectionCount * 0.15) * breathe;
          const grad = ctx.createRadialGradient(
            node.x,
            node.y,
            r * 0.3,
            node.x,
            node.y,
            glowRadius
          );
          grad.addColorStop(
            0,
            node.color.replace("rgb", "rgba").replace(")", ", 0.2)")
          );
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Node body
        const bodyGrad = ctx.createRadialGradient(
          node.x - r * 0.3,
          node.y - r * 0.3,
          r * 0.1,
          node.x,
          node.y,
          r
        );
        bodyGrad.addColorStop(0, lighten(node.color, 0.3));
        bodyGrad.addColorStop(1, node.color);
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Selected ring
        if (isSelected) {
          ctx.strokeStyle = "#f5a623";
          ctx.lineWidth = 2.5 / vp.scale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
          ctx.stroke();
        } else if (isHovered) {
          ctx.strokeStyle = "rgba(245, 166, 35, 0.5)";
          ctx.lineWidth = 1.5 / vp.scale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.globalAlpha = 1;
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [dimensions, dpr]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Tooltip (positioned in screen space) */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 shadow-lg max-w-[280px]"
          style={{
            left: tooltip.x + 16,
            top: tooltip.y - 8,
            transform:
              tooltip.x > dimensions.width - 300
                ? "translateX(-110%)"
                : undefined,
          }}
        >
          <div className="text-xs text-[var(--text-primary)] leading-relaxed line-clamp-3">
            {tooltip.node.content}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
            <span>{tooltip.node.sourceDate}</span>
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: tooltip.node.color }}
            />
            <span>{tooltip.node.source}</span>
            {tooltip.node.connectionCount > 0 && (
              <span>{tooltip.node.connectionCount} connections</span>
            )}
          </div>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
        <button
          onClick={zoomIn}
          className="w-8 h-8 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-center text-lg font-light"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={zoomOut}
          className="w-8 h-8 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-center text-lg font-light"
          title="Zoom out"
        >
          -
        </button>
        <button
          onClick={resetView}
          className="w-8 h-8 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-center"
          title="Reset view"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-11.25 11.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Utils ──────────────────────────────────────────────────────────────

function lighten(color: string, amount: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) return color;
  const [r, g, b] = match.map(Number);
  return `rgb(${Math.min(255, r + (255 - r) * amount)}, ${Math.min(
    255,
    g + (255 - g) * amount
  )}, ${Math.min(255, b + (255 - b) * amount)})`;
}
