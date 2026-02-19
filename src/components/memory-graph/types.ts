import type { SimulationNodeDatum } from "d3-force";

export interface MemoryGraphNode extends SimulationNodeDatum {
  id: string;
  content: string;
  sourceDate: string;
  strength: number;
  activationCount: number;
  source: string; // "journal" | "calendar" | "interaction"
  contactIds: string[];

  // UMAP coordinates (normalized 0–1, from server)
  ux: number;
  uy: number;

  // Runtime (set by simulation or layout)
  nodeRadius: number;
  color: string;
  connectionCount: number;

  // D3 simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  weight: number;
  connectionType: string | null;
  reason: string | null;
}

export interface MemoryGraphImplication {
  id: string;
  content: string;
  sourceMemoryIds: string[];
  implicationType: string | null;
}

export interface MemoryGraphData {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  implications: MemoryGraphImplication[];
}
