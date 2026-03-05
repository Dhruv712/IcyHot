import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { journalStateFrames, stateTransitionModels, userPredictiveStatus } from "@/db/schema";
import { resolvePredictiveSelectionForUser } from "./config";
import { getModel } from "./models/registry";
import type { ModelArtifactEnvelope, PredictiveStateFrame } from "./models/types";

function parseStateVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "number" ? item : Number(item)))
      .filter((item) => Number.isFinite(item));
  }

  if (typeof value === "string") {
    try {
      return parseStateVector(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }

  return [];
}

function parseConfig(config: unknown): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      return parseConfig(JSON.parse(config) as unknown);
    } catch {
      return {};
    }
  }

  if (typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }

  return {};
}

function parseArtifact(artifact: unknown): ModelArtifactEnvelope | null {
  if (!artifact) return null;
  if (typeof artifact === "string") {
    try {
      return parseArtifact(JSON.parse(artifact) as unknown);
    } catch {
      return null;
    }
  }

  if (typeof artifact === "object") {
    return artifact as ModelArtifactEnvelope;
  }

  return null;
}

function isMissingPredictiveSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("journal_state_frames") ||
    message.includes("state_transition_models") ||
    message.includes("user_predictive_status") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

export async function getLatestModelArtifactForUser(params: {
  userId: string;
  modelKey: string;
  modelVersion?: string | null;
}): Promise<ModelArtifactEnvelope | null> {
  try {
    const clauses: SQL[] = [
      eq(stateTransitionModels.userId, params.userId),
      eq(stateTransitionModels.modelKey, params.modelKey),
    ];
    if (params.modelVersion) {
      clauses.push(eq(stateTransitionModels.modelVersion, params.modelVersion));
    }

    const rows = await db
      .select({ artifactJson: stateTransitionModels.artifactJson })
      .from(stateTransitionModels)
      .where(and(...clauses))
      .orderBy(desc(stateTransitionModels.createdAt))
      .limit(1);

    return parseArtifact(rows[0]?.artifactJson ?? null);
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) return null;
    throw error;
  }
}

export async function trainPredictiveModelForUser(userId: string): Promise<{
  trained: boolean;
  modelKey?: string;
  modelVersion?: string;
  frameCount: number;
  reason?: string;
}> {
  try {
    const selection = await resolvePredictiveSelectionForUser(userId);
    const adapter = getModel(selection.modelKey);

    const frameRows = await db
      .select({
        entryId: journalStateFrames.entryId,
        entryDate: journalStateFrames.entryDate,
        stateVector: journalStateFrames.stateVector,
      })
      .from(journalStateFrames)
      .where(eq(journalStateFrames.userId, userId))
      .orderBy(journalStateFrames.entryDate);

    const frames: PredictiveStateFrame[] = frameRows
      .map((row) => ({
        entryId: row.entryId,
        entryDate: row.entryDate,
        vector: parseStateVector(row.stateVector),
      }))
      .filter((row) => row.vector.length > 0);

    if (frames.length === 0) {
      return {
        trained: false,
        frameCount: 0,
        reason: "no_frames",
      };
    }

    const validation = adapter.validateConfig(selection.config);
    if (!validation.ok) {
      return {
        trained: false,
        frameCount: frames.length,
        reason: validation.errors.join(" "),
      };
    }

    const artifact = await adapter.train(frames, selection.config);
    await db.insert(stateTransitionModels).values({
      userId,
      modelKey: artifact.modelKey,
      modelVersion: artifact.modelVersion,
      artifactSchemaVersion: artifact.artifactSchemaVersion,
      trainedThroughEntryDate: artifact.trainedThroughEntryDate,
      configJson: parseConfig(selection.config),
      metricsJson: artifact.metrics,
      artifactJson: artifact,
      createdAt: new Date(),
    });

    await db
      .insert(userPredictiveStatus)
      .values({
        userId,
        lastTrainedAt: new Date(),
        activeModelKey: artifact.modelKey,
        activeModelVersion: artifact.modelVersion,
        framesCount: frames.length,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPredictiveStatus.userId,
        set: {
          lastTrainedAt: new Date(),
          activeModelKey: artifact.modelKey,
          activeModelVersion: artifact.modelVersion,
          framesCount: frames.length,
          updatedAt: new Date(),
        },
      });

    return {
      trained: true,
      modelKey: artifact.modelKey,
      modelVersion: artifact.modelVersion,
      frameCount: frames.length,
    };
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) {
      return {
        trained: false,
        frameCount: 0,
        reason: "predictive_schema_missing",
      };
    }

    throw error;
  }
}
