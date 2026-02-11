import type { GraphNode } from "./types";

export function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
  dpr: number,
  time: number
) {
  // Sort by importance so important nodes render on top
  const sorted = [...nodes].sort((a, b) => {
    if (a.id === "me") return 1; // "me" always on top
    if (b.id === "me") return -1;
    return a.importance - b.importance;
  });

  for (let idx = 0; idx < sorted.length; idx++) {
    const node = sorted[idx];
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    // Glow effect for warm nodes (with breathing animation)
    if (node.temperature > 0.2 && node.id !== "me") {
      const breathe =
        Math.sin(time * 0.0015 + idx * 0.7) * 0.15 + 0.85;
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
      gradient.addColorStop(0, node.color + "50");
      gradient.addColorStop(0.5, node.color + "20");
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
        `rgba(255, 255, 255, ${(0.2 * pulse).toFixed(2)})`
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
      coreGradient.addColorStop(0, "#ffffff");
      coreGradient.addColorStop(1, "#c0c0c0");
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Label — font size in canvas units, appears as 16 CSS pixels
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(16 * dpr)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Me", x, y + node.nodeRadius + 8 * dpr);
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

    // Selection/hover ring
    if (node.id === selectedNodeId) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius + 4 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    } else if (node.id === hoveredNodeId) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius + 3 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Name label — font size in canvas units, appears as fontSize CSS pixels
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    const fontSize = Math.max(10, 9 + node.importance * 0.4);
    ctx.font = `${Math.round(fontSize * dpr)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(node.name, x, y + node.nodeRadius + 6 * dpr);
  }
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
