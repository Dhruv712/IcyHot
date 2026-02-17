import type { SimulationNodeDatum } from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  email: string | null;
  temperature: number;
  importance: number;
  orbitalRadius: number;
  nodeRadius: number;
  color: string;
  mass: number;
  groupIds: string[];
  groupAngle: number | null;
  lastInteraction: string | null;
  nudgeScore: number;
  interactionCount: number;
  relationshipType: string;
  hasCalendarEvents: boolean;
}

export interface GraphGroup {
  id: string;
  name: string;
  color: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  groups: GraphGroup[];
  healthScore: number;
}
