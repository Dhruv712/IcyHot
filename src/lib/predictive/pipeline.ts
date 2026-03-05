import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPredictiveStatus } from "@/db/schema";
import { resolvePredictiveSelectionForUser } from "./config";
import { scoreMemoriesForUser } from "./scoring";
import { getPredictiveMinFrames } from "./settings";
import { syncStateFramesForUser } from "./stateFrames";
import { trainPredictiveModelForUser } from "./training";

const MIN_FRAMES_TO_ACTIVATE = getPredictiveMinFrames();

function isMissingPredictiveSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("user_predictive_status") ||
    message.includes("predictive") && message.includes("does not exist")
  );
}

export async function refreshPredictiveModelForUser(userId: string): Promise<{
  syncedFrames: number;
  trained: boolean;
  scored: number;
  modelKey?: string;
  modelVersion?: string;
  skipped?: string;
}> {
  try {
    const frameSync = await syncStateFramesForUser(userId);

    const [status] = await db
      .select()
      .from(userPredictiveStatus)
      .where(eq(userPredictiveStatus.userId, userId))
      .limit(1);

    if (!status?.backfillCompleteAt) {
      return {
        syncedFrames: frameSync.framesUpserted,
        trained: false,
        scored: 0,
        skipped: "backfill_incomplete",
      };
    }

    if ((status.framesCount ?? 0) < MIN_FRAMES_TO_ACTIVATE) {
      return {
        syncedFrames: frameSync.framesUpserted,
        trained: false,
        scored: 0,
        skipped: "insufficient_frames",
      };
    }

    const selection = await resolvePredictiveSelectionForUser(userId);
    const trainResult = await trainPredictiveModelForUser(userId);
    if (!trainResult.trained) {
      return {
        syncedFrames: frameSync.framesUpserted,
        trained: false,
        scored: 0,
        skipped: trainResult.reason || "training_skipped",
      };
    }

    const trained = true;
    const modelVersion = trainResult.modelVersion;

    const scoreResult = await scoreMemoriesForUser(userId);
    return {
      syncedFrames: frameSync.framesUpserted,
      trained,
      scored: scoreResult.scored,
      modelKey: scoreResult.modelKey ?? selection.modelKey,
      modelVersion: scoreResult.modelVersion ?? modelVersion,
      skipped: scoreResult.reason,
    };
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) {
      return {
        syncedFrames: 0,
        trained: false,
        scored: 0,
        skipped: "predictive_schema_missing",
      };
    }

    throw error;
  }
}
