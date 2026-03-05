import type {
  LoadedModelHandle,
  ModelArtifactEnvelope,
  PredictiveContext,
  PredictiveMemoryCandidate,
  PredictiveModelAdapter,
  PredictiveScore,
  PredictiveStateFrame,
  ValidationResult,
} from "./types";

const MODEL_KEY = "nn_temporal_v1";
const MODEL_VERSION = "0.0.1-shadow";
const ARTIFACT_SCHEMA_VERSION = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeActivation(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + 1);
}

function isEnabled(): boolean {
  return process.env.PREDICTIVE_ENABLE_NN_TEMPORAL === "1";
}

export const nnTemporalPlaceholderModel: PredictiveModelAdapter = {
  modelKey: () => MODEL_KEY,
  modelVersion: () => MODEL_VERSION,
  artifactSchemaVersion: () => ARTIFACT_SCHEMA_VERSION,
  validateConfig(): ValidationResult {
    if (!isEnabled()) {
      return {
        ok: false,
        errors: [
          "nn_temporal_v1 is disabled. Set PREDICTIVE_ENABLE_NN_TEMPORAL=1 to enable it.",
        ],
      };
    }

    return { ok: true, errors: [] };
  },
  async train(
    frames: PredictiveStateFrame[],
    config: Record<string, unknown>
  ): Promise<ModelArtifactEnvelope> {
    return {
      modelKey: MODEL_KEY,
      modelVersion: MODEL_VERSION,
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      trainedThroughEntryDate: frames.at(-1)?.entryDate ?? new Date().toISOString().slice(0, 10),
      metrics: {
        frameCount: frames.length,
      },
      payload: {
        mode: "shadow_placeholder",
        config,
      },
    };
  },
  load(artifact: ModelArtifactEnvelope): LoadedModelHandle {
    return {
      modelKey: artifact.modelKey,
      modelVersion: artifact.modelVersion,
      payload: artifact.payload,
    };
  },
  scoreMemory(memory: PredictiveMemoryCandidate): PredictiveScore {
    return {
      score: Number(clamp(normalizeActivation(memory.activationScore), 0, 1).toFixed(6)),
      components: {
        semantic: Number(normalizeActivation(memory.activationScore).toFixed(6)),
      },
    };
  },
  explain(
    memory: PredictiveMemoryCandidate,
    context: PredictiveContext,
    handle: LoadedModelHandle,
    score: PredictiveScore
  ): string[] {
    void memory;
    void context;
    void handle;
    void score;

    return [
      "Neural temporal model is running in placeholder shadow mode.",
      "Ranking currently falls back to semantic activation behavior.",
    ];
  },
};
