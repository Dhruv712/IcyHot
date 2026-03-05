import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  memories,
  memoryPredictiveScores,
  stateTransitionModels,
  userPredictiveStatus,
} from "@/db/schema";
import { resolvePredictiveSelectionForUser } from "./config";
import { getModel } from "./models/registry";
import type { ModelArtifactEnvelope, PredictiveContext, PredictiveMemoryCandidate } from "./models/types";
import { getLatestModelArtifactForUser, trainPredictiveModelForUser } from "./training";

function parseContactIds(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      return parseContactIds(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }

  return [];
}

function isMissingPredictiveSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("memory_predictive_scores") ||
    message.includes("state_transition_models") ||
    message.includes("user_predictive_status") ||
    message.includes("predictive_model_overrides") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

function parseArtifact(value: unknown): ModelArtifactEnvelope | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseArtifact(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value as ModelArtifactEnvelope;
  }

  return null;
}

export async function scoreMemoriesForUser(userId: string): Promise<{
  scored: number;
  modelKey?: string;
  modelVersion?: string;
  reason?: string;
}> {
  try {
    const selection = await resolvePredictiveSelectionForUser(userId);
    const adapter = getModel(selection.modelKey);

    const [status] = await db
      .select()
      .from(userPredictiveStatus)
      .where(eq(userPredictiveStatus.userId, userId))
      .limit(1);

    if (!status?.backfillCompleteAt) {
      return {
        scored: 0,
        reason: "backfill_incomplete",
      };
    }

    let artifact = await getLatestModelArtifactForUser({
      userId,
      modelKey: selection.modelKey,
      modelVersion: status.activeModelVersion,
    });

    if (!artifact || artifact.modelKey !== selection.modelKey) {
      const trainResult = await trainPredictiveModelForUser(userId);
      if (!trainResult.trained) {
        return {
          scored: 0,
          reason: trainResult.reason || "training_skipped",
        };
      }

      artifact = await getLatestModelArtifactForUser({
        userId,
        modelKey: selection.modelKey,
      });
    }

    if (!artifact) {
      return {
        scored: 0,
        reason: "missing_artifact",
      };
    }

    const loaded = adapter.load(artifact);
    const context: PredictiveContext = {
      now: new Date(),
    };

    const memoryRows = await db
      .select({
        id: memories.id,
        content: memories.content,
        sourceDate: memories.sourceDate,
        contactIds: memories.contactIds,
        strength: memories.strength,
      })
      .from(memories)
      .where(eq(memories.userId, userId));

    let scored = 0;

    for (const row of memoryRows) {
      const candidate: PredictiveMemoryCandidate = {
        id: row.id,
        content: row.content,
        sourceDate: row.sourceDate,
        activationScore: row.strength,
        hop: 0,
        contactIds: parseContactIds(row.contactIds),
      };

      const score = adapter.scoreMemory(candidate, context, loaded);
      const why = adapter.explain(candidate, context, loaded, score);

      await db
        .insert(memoryPredictiveScores)
        .values({
          userId,
          memoryId: row.id,
          modelKey: artifact.modelKey,
          modelVersion: artifact.modelVersion,
          predictiveScore: score.score,
          whyJson: why,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            memoryPredictiveScores.userId,
            memoryPredictiveScores.memoryId,
            memoryPredictiveScores.modelKey,
            memoryPredictiveScores.modelVersion,
          ],
          set: {
            predictiveScore: score.score,
            whyJson: why,
            updatedAt: new Date(),
          },
        });

      scored += 1;
    }

    await db
      .insert(userPredictiveStatus)
      .values({
        userId,
        activeModelKey: artifact.modelKey,
        activeModelVersion: artifact.modelVersion,
        lastTrainedAt: status?.lastTrainedAt ?? new Date(),
        framesCount: status?.framesCount ?? 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPredictiveStatus.userId,
        set: {
          activeModelKey: artifact.modelKey,
          activeModelVersion: artifact.modelVersion,
          updatedAt: new Date(),
        },
      });

    return {
      scored,
      modelKey: artifact.modelKey,
      modelVersion: artifact.modelVersion,
    };
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) {
      return {
        scored: 0,
        reason: "predictive_schema_missing",
      };
    }

    throw error;
  }
}

export async function getPredictiveArtifactForUser(params: {
  userId: string;
  modelKey: string;
  modelVersion: string;
}): Promise<ModelArtifactEnvelope | null> {
  try {
    const [row] = await db
      .select({ artifactJson: stateTransitionModels.artifactJson })
      .from(stateTransitionModels)
      .where(
        and(
          eq(stateTransitionModels.userId, params.userId),
          eq(stateTransitionModels.modelKey, params.modelKey),
          eq(stateTransitionModels.modelVersion, params.modelVersion)
        )
      )
      .limit(1);

    return parseArtifact(row?.artifactJson ?? null);
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) return null;
    throw error;
  }
}
