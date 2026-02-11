import type { SimulationNodeDatum } from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  temperature: number;
  importance: number;
  orbitalRadius: number;
  nodeRadius: number;
  color: string;
  mass: number;
  groupId: string | null;
  groupAngle: number | null;
  lastInteraction: string | null;
  nudgeScore: number;
  interactionCount: number;
  relationshipType: string;
}

export interface GraphGroup {
  id: string;
  name: string;
  color: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  groups: GraphGroup[];
}
