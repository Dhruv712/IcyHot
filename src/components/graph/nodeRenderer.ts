import type { GraphNode } from "./types";

export function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
  dpr: number
) {
  // Sort by importance so important nodes render on top
  const sorted = [...nodes].sort((a, b) => {
    if (a.id === "me") return 1; // "me" always on top
    if (b.id === "me") return -1;
    return a.importance - b.importance;
  });

  for (const node of sorted) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    // Glow effect for warm nodes
    if (node.temperature > 0.2 && node.id !== "me") {
      const glowRadius = node.nodeRadius * (1.5 + node.temperature * 1.5);
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
      // Subtle pulse glow
      const gradient = ctx.createRadialGradient(
        x,
        y,
        node.nodeRadius * 0.3,
        x,
        y,
        node.nodeRadius * 2
      );
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.15)");
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius * 2, 0, Math.PI * 2);
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

      // Label
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${14 / dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Me", x, y + node.nodeRadius + 8);
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
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (node.id === hoveredNodeId) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, node.nodeRadius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Name label
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    const fontSize = Math.max(10, 9 + node.importance * 0.4);
    ctx.font = `${fontSize / dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(node.name, x, y + node.nodeRadius + 6);
  }
}

function lighten(color: string, amount: number): string {
  // Parse rgb(r,g,b) and lighten
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) return color;
  const r = Math.min(255, Math.round(parseInt(match[1]) + (255 - parseInt(match[1])) * amount));
  const g = Math.min(255, Math.round(parseInt(match[2]) + (255 - parseInt(match[2])) * amount));
  const b = Math.min(255, Math.round(parseInt(match[3]) + (255 - parseInt(match[3])) * amount));
  return `rgb(${r},${g},${b})`;
}
