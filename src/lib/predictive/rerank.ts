import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  memoryPredictiveScores,
  stateTransitionModels,
  userPredictiveStatus,
} from "@/db/schema";
import type { RetrievalResult } from "@/lib/memory/retrieve";
import { getModel } from "./models/registry";
import type { ModelArtifactEnvelope, PredictiveScore } from "./models/types";
import { resolvePredictiveSelectionForUser } from "./config";
import { scoreMemoriesForUser } from "./scoring";
import { getPredictiveMinFrames } from "./settings";

export type PredictiveMemoryMetadata = {
  score: number;
  rankDelta: number;
  why: string[];
  modelKey: string;
  modelVersion: string;
};

export type PredictiveRerankResult = {
  retrieval: RetrievalResult;
  metadataByMemoryId: Record<string, PredictiveMemoryMetadata>;
  applied: boolean;
  reason?: string;
};

const MIN_BACKFILL_FRAMES = getPredictiveMinFrames();
const BASE_WEIGHT = 0.72;
const PREDICTIVE_WEIGHT = 0.28;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeActivation(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + 1);
}

function parseWhy(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseWhy(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseArtifactEnvelope(value: unknown): ModelArtifactEnvelope | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as ModelArtifactEnvelope;
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value as ModelArtifactEnvelope;
  }

  return null;
}

function isMissingPredictiveSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("memory_predictive_scores") ||
    message.includes("user_predictive_status") ||
    message.includes("state_transition_models") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

export async function rerankRetrievalForChat(params: {
  userId: string;
  question: string;
  retrieval: RetrievalResult;
}): Promise<PredictiveRerankResult> {
  if (params.retrieval.memories.length === 0) {
    return {
      retrieval: params.retrieval,
      metadataByMemoryId: {},
      applied: false,
      reason: "no_memories",
    };
  }

  try {
    const [status] = await db
      .select()
      .from(userPredictiveStatus)
      .where(eq(userPredictiveStatus.userId, params.userId))
      .limit(1);

    if (!status?.backfillCompleteAt) {
      return {
        retrieval: params.retrieval,
        metadataByMemoryId: {},
        applied: false,
        reason: "backfill_incomplete",
      };
    }

    if ((status.framesCount ?? 0) < MIN_BACKFILL_FRAMES) {
      return {
        retrieval: params.retrieval,
        metadataByMemoryId: {},
        applied: false,
        reason: "insufficient_frames",
      };
    }

    const selection = await resolvePredictiveSelectionForUser(params.userId);
    let activeModelKey = status.activeModelKey;
    let activeModelVersion = status.activeModelVersion;

    if (activeModelKey !== selection.modelKey || !activeModelVersion) {
      const refresh = await scoreMemoriesForUser(params.userId);
      if (refresh.reason) {
        return {
          retrieval: params.retrieval,
          metadataByMemoryId: {},
          applied: false,
          reason: refresh.reason,
        };
      }

      const [refreshedStatus] = await db
        .select()
        .from(userPredictiveStatus)
        .where(eq(userPredictiveStatus.userId, params.userId))
        .limit(1);

      activeModelKey = refreshedStatus?.activeModelKey ?? null;
      activeModelVersion = refreshedStatus?.activeModelVersion ?? null;
      if (activeModelKey !== selection.modelKey || !activeModelVersion) {
        return {
          retrieval: params.retrieval,
          metadataByMemoryId: {},
          applied: false,
          reason: "model_stale",
        };
      }
    }

    const memoryIds = params.retrieval.memories.map((memory) => memory.id);
    const scoreRows = await db
      .select({
        memoryId: memoryPredictiveScores.memoryId,
        predictiveScore: memoryPredictiveScores.predictiveScore,
        whyJson: memoryPredictiveScores.whyJson,
      })
      .from(memoryPredictiveScores)
      .where(
        and(
          eq(memoryPredictiveScores.userId, params.userId),
          eq(memoryPredictiveScores.modelKey, selection.modelKey),
          eq(memoryPredictiveScores.modelVersion, activeModelVersion),
          inArray(memoryPredictiveScores.memoryId, memoryIds)
        )
      );

    if (scoreRows.length === 0) {
      return {
        retrieval: params.retrieval,
        metadataByMemoryId: {},
        applied: false,
        reason: "no_scores",
      };
    }

    const scoreByMemoryId = new Map(
      scoreRows.map((row) => [
        row.memoryId,
        {
          score: clamp(Number(row.predictiveScore ?? 0), 0, 1),
          why: parseWhy(row.whyJson),
        },
      ])
    );

    const [artifactRow] = await db
      .select({ artifactJson: stateTransitionModels.artifactJson })
      .from(stateTransitionModels)
      .where(
        and(
          eq(stateTransitionModels.userId, params.userId),
          eq(stateTransitionModels.modelKey, selection.modelKey),
          eq(stateTransitionModels.modelVersion, activeModelVersion)
        )
      )
      .orderBy(desc(stateTransitionModels.createdAt))
      .limit(1);

    const adapter = getModel(selection.modelKey);
    const handle = artifactRow ? adapter.load(parseArtifactEnvelope(artifactRow.artifactJson) ?? {
      modelKey: selection.modelKey,
      modelVersion: activeModelVersion,
      artifactSchemaVersion: adapter.artifactSchemaVersion(),
      trainedThroughEntryDate: new Date().toISOString().slice(0, 10),
      metrics: {},
      payload: {},
    }) : null;

    const baselineRanks = new Map(
      params.retrieval.memories.map((memory, index) => [memory.id, index])
    );

    const rerankedMemories = [...params.retrieval.memories].sort((a, b) => {
      const aPredictive = scoreByMemoryId.get(a.id)?.score ?? 0;
      const bPredictive = scoreByMemoryId.get(b.id)?.score ?? 0;
      const aCombined =
        BASE_WEIGHT * normalizeActivation(a.activationScore) + PREDICTIVE_WEIGHT * aPredictive;
      const bCombined =
        BASE_WEIGHT * normalizeActivation(b.activationScore) + PREDICTIVE_WEIGHT * bPredictive;

      if (bCombined === aCombined) {
        return b.activationScore - a.activationScore;
      }

      return bCombined - aCombined;
    });

    const metadataByMemoryId: Record<string, PredictiveMemoryMetadata> = {};
    rerankedMemories.forEach((memory, index) => {
      const priorRank = baselineRanks.get(memory.id) ?? index;
      const predictive = scoreByMemoryId.get(memory.id);
      const score: PredictiveScore = {
        score: predictive?.score ?? 0,
        components: {
          activation: Number(normalizeActivation(memory.activationScore).toFixed(6)),
        },
      };

      const why =
        predictive?.why.length
          ? predictive.why
          : handle
            ? adapter.explain(
                {
                  id: memory.id,
                  content: memory.content,
                  sourceDate: memory.sourceDate,
                  activationScore: memory.activationScore,
                  hop: memory.hop,
                  contactIds: memory.contactIds,
                },
                {
                  question: params.question,
                  now: new Date(),
                },
                handle,
                score
              )
            : ["Predictive score available but model rationale is unavailable."];

      metadataByMemoryId[memory.id] = {
        score: Number((predictive?.score ?? 0).toFixed(6)),
        rankDelta: priorRank - index,
        why,
        modelKey: selection.modelKey,
        modelVersion: activeModelVersion,
      };
    });

    return {
      retrieval: {
        ...params.retrieval,
        memories: rerankedMemories,
      },
      metadataByMemoryId,
      applied: true,
    };
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) {
      return {
        retrieval: params.retrieval,
        metadataByMemoryId: {},
        applied: false,
        reason: "predictive_storage_missing",
      };
    }
    throw error;
  }
}
