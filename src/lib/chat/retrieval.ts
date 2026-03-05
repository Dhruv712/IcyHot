import type { RetrievalResult } from "@/lib/memory/retrieve";
import type { ChatRetrievalStats, ChatSourcesPayload } from "./types";
import type { PredictiveMemoryMetadata } from "@/lib/predictive/rerank";

const MAX_PROMPT_MEMORIES = 10;
const MAX_PROMPT_IMPLICATIONS = 6;
const MAX_PROMPT_CONNECTIONS = 8;

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 3).trimEnd()}...`;
}

export function buildChatRetrievalStats(result: RetrievalResult): ChatRetrievalStats {
  return {
    memories: result.memories.length,
    implications: result.implications.length,
    connections: result.connections.length,
  };
}

export function buildChatSources(
  result: RetrievalResult,
  predictiveByMemoryId?: Record<string, PredictiveMemoryMetadata>
): ChatSourcesPayload {
  return {
    memories: result.memories.map((memory) => ({
      id: memory.id,
      date: memory.sourceDate,
      snippet: truncate(memory.content, 220),
      activationScore: Number(memory.activationScore.toFixed(3)),
      hop: memory.hop,
      predictive: predictiveByMemoryId?.[memory.id]
        ? {
            score: Number(predictiveByMemoryId[memory.id].score.toFixed(3)),
            rankDelta: predictiveByMemoryId[memory.id].rankDelta,
            modelKey: predictiveByMemoryId[memory.id].modelKey,
            modelVersion: predictiveByMemoryId[memory.id].modelVersion,
            why: predictiveByMemoryId[memory.id].why,
          }
        : undefined,
    })),
    implications: result.implications.map((implication) => ({
      id: implication.id,
      content: truncate(implication.content, 220),
      implicationType: implication.implicationType,
      sourceMemoryIds: implication.sourceMemoryIds,
    })),
    connections: result.connections.map((connection) => ({
      fromId: connection.fromId,
      toId: connection.toId,
      connectionType: connection.connectionType,
      reason: connection.reason ? truncate(connection.reason, 220) : null,
    })),
  };
}

export function buildChatPromptContext(result: RetrievalResult): {
  memories: string;
  implications: string;
  connections: string;
} {
  const memoryLines = result.memories
    .slice(0, MAX_PROMPT_MEMORIES)
    .map(
      (memory) =>
        `- [${memory.sourceDate}] score=${memory.activationScore.toFixed(3)} hop=${memory.hop}: ${truncate(memory.content, 320)}`,
    )
    .join("\n");

  const implicationLines = result.implications
    .slice(0, MAX_PROMPT_IMPLICATIONS)
    .map(
      (implication) =>
        `- ${implication.implicationType ?? "insight"}: ${truncate(implication.content, 320)}`,
    )
    .join("\n");

  const connectionLines = result.connections
    .slice(0, MAX_PROMPT_CONNECTIONS)
    .map((connection) => {
      const reason = connection.reason ? truncate(connection.reason, 240) : "No explicit reason stored.";
      return `- ${connection.connectionType ?? "link"}: ${reason}`;
    })
    .join("\n");

  return {
    memories: memoryLines || "(none)",
    implications: implicationLines || "(none)",
    connections: connectionLines || "(none)",
  };
}
