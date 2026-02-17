import type { GraphNode } from "./types";

export function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
  time: number,
  focusedNodeId: string | null = null
) {
  // Sort by importance so important nodes render on top
  // When focused, draw focused + me node last (on top)
  const sorted = [...nodes].sort((a, b) => {
    if (a.id === "me") return 1; // "me" always on top
    if (b.id === "me") return -1;
    if (focusedNodeId) {
      if (a.id === focusedNodeId) return 1;
      if (b.id === focusedNodeId) return -1;
    }
    return a.importance - b.importance;
  });

  const isFocusMode = focusedNodeId !== null;

  for (let idx = 0; idx < sorted.length; idx++) {
    const node = sorted[idx];
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    // In focus mode, dim nodes that aren't the focused contact or "Me"
    const isHighlighted = node.id === "me" || node.id === focusedNodeId;
    if (isFocusMode && !isHighlighted) {
      ctx.globalAlpha = 0.15;
    }

    // Glow effect for warm nodes (with breathing animation)
    if (node.temperature > 0.2 && node.id !== "me") {
      const breathe =
        Math.sin(time * 0.0015 + idx * 0.7) * 0.08 + 0.92;
      const glowRadius =
        node.nodeRadius * (1.5 + node.temperature * 1.5) * breathe;
      const gradient = ctx.createRadialGradient(
        x,
        y,
        node.nodeRadius * 0.3,
        x,
        y,
        glowRadius
      );
      gradient.addColorStop(0, withAlpha(node.color, 0.3));
      gradient.addColorStop(0.5, withAlpha(node.color, 0.12));
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // "Me" node special rendering
    if (node.id === "me") {
      // Pulsing glow
      const pulse = Math.sin(time * 0.002) * 0.15 + 0.85;
      const glowRadius = node.nodeRadius * 2.5 * pulse;
      const gradient = ctx.createRadialGradient(
        x,
        y,
        node.nodeRadius * 0.3,
        x,
        y,
        glowRadius
      );
      gradient.addColorStop(
        0,
        `rgba(245, 240, 232, ${(0.2 * pulse).toFixed(2)})`
      );
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Core circle
      const coreGradient = ctx.createRadialGradient(
        x - node.nodeRadius * 0.3,
        y - node.nodeRadius * 0.3,
        0,
        x,
        y,
        node.nodeRadius
      );
      coreGradient.addColorStop(0, "#f5f0e8");
      coreGradient.addColorStop(1, "#b8a88a");
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Label in CSS pixels
      ctx.fillStyle = "#f5f0e8";
      ctx.font = `bold 16px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Me", x, y + node.nodeRadius + 8);
      ctx.globalAlpha = 1;
      continue;
    }

    // Main node circle with subtle gradient
    const nodeGradient = ctx.createRadialGradient(
      x - node.nodeRadius * 0.3,
      y - node.nodeRadius * 0.3,
      0,
      x,
      y,
      node.nodeRadius
    );
    nodeGradient.addColorStop(0, lighten(node.color, 0.2));
    nodeGradient.addColorStop(1, node.color);
    ctx.fillStyle = nodeGradient;
    ctx.beginPath();
    ctx.arc(x, y, node.nodeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Selection/hover ring (CSS pixels)
    if (node.id === selectedNodeId) {
      ctx.strokeStyle = "#d4a853";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (node.id === hoveredNodeId) {
      ctx.strokeStyle = "rgba(212, 168, 83, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Name label in CSS pixels
    ctx.fillStyle = "rgba(245, 240, 232, 0.8)";
    const fontSize = Math.max(10, 9 + node.importance * 0.4);
    ctx.font = `${Math.round(fontSize)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const nameText = node.hasCalendarEvents ? `📅 ${node.name}` : node.name;
    ctx.fillText(nameText, x, y + node.nodeRadius + 6);

    // Reset alpha after each node in focus mode
    if (isFocusMode) ctx.globalAlpha = 1;
  }
}

function withAlpha(color: string, alpha: number): string {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return color;
  return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
}

function lighten(color: string, amount: number): string {
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) return color;
  const r = Math.min(
    255,
    Math.round(parseInt(match[1]) + (255 - parseInt(match[1])) * amount)
  );
  const g = Math.min(
    255,
    Math.round(parseInt(match[2]) + (255 - parseInt(match[2])) * amount)
  );
  const b = Math.min(
    255,
    Math.round(parseInt(match[3]) + (255 - parseInt(match[3])) * amount)
  );
  return `rgb(${r},${g},${b})`;
}
