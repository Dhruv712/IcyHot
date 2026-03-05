import type {
  LoadedModelHandle,
  ModelArtifactEnvelope,
  PredictiveLearningSummary,
  PredictiveContext,
  PredictiveMemoryCandidate,
  PredictiveModelAdapter,
  PredictiveScore,
  PredictiveStateFrame,
  ValidationResult,
} from "./types";

const MODEL_KEY = "seq_linear_v1";
const MODEL_VERSION = "1.0.0";
const ARTIFACT_SCHEMA_VERSION = 1;

type SeqLinearConfig = {
  activationWeight: number;
  recencyWeight: number;
  hopPenalty: number;
};

type SeqLinearPayload = {
  config: SeqLinearConfig;
  centroid: number[];
  trend: number[];
};

const DEFAULT_CONFIG: SeqLinearConfig = {
  activationWeight: 0.62,
  recencyWeight: 0.24,
  hopPenalty: 0.17,
};

const CORE10_DIMENSIONS = [
  "emotionalIntensity",
  "valence",
  "decision",
  "relationship",
  "uncertainty",
  "belief",
  "action",
  "calm",
  "stress",
  "novelty",
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeActivation(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + 1);
}

function recencySignal(sourceDate: string, now: Date): number {
  const parsed = new Date(`${sourceDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 0.5;
  const days = Math.max(0, (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  return clamp(1 - days / 120, 0, 1);
}

function hopSignal(hop: number, hopPenalty: number): number {
  if (hop <= 0) return 1;
  return clamp(1 - hop * hopPenalty, 0, 1);
}

function parseConfig(config: unknown): SeqLinearConfig {
  const incoming = (config ?? {}) as Partial<SeqLinearConfig>;
  return {
    activationWeight:
      typeof incoming.activationWeight === "number"
        ? incoming.activationWeight
        : DEFAULT_CONFIG.activationWeight,
    recencyWeight:
      typeof incoming.recencyWeight === "number"
        ? incoming.recencyWeight
        : DEFAULT_CONFIG.recencyWeight,
    hopPenalty:
      typeof incoming.hopPenalty === "number"
        ? incoming.hopPenalty
        : DEFAULT_CONFIG.hopPenalty,
  };
}

function averageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dimension = vectors[0]?.length ?? 0;
  const totals = Array.from({ length: dimension }, () => 0);

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i++) {
      totals[i] += vector[i] ?? 0;
    }
  }

  return totals.map((total) => total / vectors.length);
}

function averageTrend(vectors: number[][]): number[] {
  if (vectors.length < 2) return vectors[0] ? vectors[0].map(() => 0) : [];
  const dimension = vectors[0]?.length ?? 0;
  const totals = Array.from({ length: dimension }, () => 0);

  for (let i = 1; i < vectors.length; i++) {
    for (let j = 0; j < dimension; j++) {
      totals[j] += (vectors[i]?.[j] ?? 0) - (vectors[i - 1]?.[j] ?? 0);
    }
  }

  return totals.map((total) => total / (vectors.length - 1));
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function formatSigned(value: number): string {
  const rounded = Number(value.toFixed(4));
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export const seqLinearModel: PredictiveModelAdapter = {
  modelKey: () => MODEL_KEY,
  modelVersion: () => MODEL_VERSION,
  artifactSchemaVersion: () => ARTIFACT_SCHEMA_VERSION,
  validateConfig(config: unknown): ValidationResult {
    const parsed = parseConfig(config);
    const errors: string[] = [];

    if (parsed.activationWeight < 0 || parsed.activationWeight > 1) {
      errors.push("activationWeight must be between 0 and 1.");
    }
    if (parsed.recencyWeight < 0 || parsed.recencyWeight > 1) {
      errors.push("recencyWeight must be between 0 and 1.");
    }
    if (parsed.hopPenalty < 0 || parsed.hopPenalty > 1) {
      errors.push("hopPenalty must be between 0 and 1.");
    }

    return { ok: errors.length === 0, errors };
  },
  async train(
    frames: PredictiveStateFrame[],
    config: Record<string, unknown>
  ): Promise<ModelArtifactEnvelope> {
    const parsed = parseConfig(config);
    const ordered = [...frames].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const vectors = ordered.map((frame) => frame.vector);
    const centroid = averageVector(vectors);
    const trend = averageTrend(vectors);

    return {
      modelKey: MODEL_KEY,
      modelVersion: MODEL_VERSION,
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      trainedThroughEntryDate: ordered.at(-1)?.entryDate ?? new Date().toISOString().slice(0, 10),
      metrics: {
        frameCount: ordered.length,
        dimension: centroid.length,
        centroidNorm: Number(vectorNorm(centroid).toFixed(6)),
        trendNorm: Number(vectorNorm(trend).toFixed(6)),
      },
      payload: {
        config: parsed,
        centroid,
        trend,
      } satisfies SeqLinearPayload,
    };
  },
  load(artifact: ModelArtifactEnvelope): LoadedModelHandle {
    return {
      modelKey: artifact.modelKey,
      modelVersion: artifact.modelVersion,
      payload: artifact.payload,
    };
  },
  scoreMemory(
    memory: PredictiveMemoryCandidate,
    context: PredictiveContext,
    handle: LoadedModelHandle
  ): PredictiveScore {
    const payload = (handle.payload ?? {}) as Partial<SeqLinearPayload>;
    const config = parseConfig(payload.config);

    const activation = normalizeActivation(memory.activationScore);
    const recency = recencySignal(memory.sourceDate, context.now);
    const hop = hopSignal(memory.hop, config.hopPenalty);

    const remainingWeight = Math.max(0, 1 - config.activationWeight - config.recencyWeight);
    const denominator = config.activationWeight + config.recencyWeight + remainingWeight;

    const score =
      denominator > 0
        ? (activation * config.activationWeight + recency * config.recencyWeight + hop * remainingWeight) /
          denominator
        : 0;

    return {
      score: Number(clamp(score, 0, 1).toFixed(6)),
      components: {
        activation: Number(activation.toFixed(6)),
        recency: Number(recency.toFixed(6)),
        hop: Number(hop.toFixed(6)),
      },
    };
  },
  explain(
    memory: PredictiveMemoryCandidate,
    context: PredictiveContext,
    handle: LoadedModelHandle,
    score: PredictiveScore
  ): string[] {
    const reasons: string[] = [];
    if (score.components.activation >= 0.65) {
      reasons.push("High activation relevance to the current question.");
    }

    if (score.components.recency >= 0.65) {
      reasons.push("Recent memory likely to shape near-term trajectory.");
    }

    if (score.components.hop < 0.5) {
      reasons.push("Lower confidence because this memory was discovered through a distant hop.");
    }

    if (reasons.length === 0) {
      reasons.push("Moderate predictive utility based on activation, recency, and graph distance.");
    }

    // Keep signature parity even if currently unused by rule engine.
    void memory;
    void context;
    void handle;

    return reasons;
  },
  predictNextState(
    history: PredictiveStateFrame[],
    config: Record<string, unknown>,
    handle: LoadedModelHandle
  ): number[] {
    void config;

    const payload = (handle.payload ?? {}) as Partial<SeqLinearPayload>;
    const centroid = Array.isArray(payload.centroid)
      ? payload.centroid.map((value) => (typeof value === "number" ? value : Number(value)))
      : [];
    const trend = Array.isArray(payload.trend)
      ? payload.trend.map((value) => (typeof value === "number" ? value : Number(value)))
      : [];
    const lastVector = history.at(-1)?.vector ?? centroid;
    const dimension = Math.max(lastVector.length, centroid.length, trend.length);
    if (dimension === 0) return [];

    const projected = Array.from({ length: dimension }, (_, index) => {
      const base = lastVector[index] ?? centroid[index] ?? 0;
      const drift = trend[index] ?? 0;
      const centroidAnchor = centroid[index] ?? base;
      const combined = base + drift * 0.65 + (centroidAnchor - base) * 0.18;
      return Number(clamp(combined, 0, 1).toFixed(6));
    });

    return projected;
  },
  summarizeLearning(handle: LoadedModelHandle): PredictiveLearningSummary {
    const payload = (handle.payload ?? {}) as Partial<SeqLinearPayload>;
    const centroid = Array.isArray(payload.centroid)
      ? payload.centroid.map((value) => (typeof value === "number" ? value : Number(value)))
      : [];
    const trend = Array.isArray(payload.trend)
      ? payload.trend.map((value) => (typeof value === "number" ? value : Number(value)))
      : [];

    const rankedTrendSignals = trend
      .map((value, index) => ({ index, magnitude: Math.abs(value), value }))
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 3);

    const keySignals = rankedTrendSignals.map((signal) => {
      const label = CORE10_DIMENSIONS[signal.index] ?? `dim_${signal.index + 1}`;
      return `${label}: ${formatSigned(signal.value)} trend`;
    });

    const summaryText =
      keySignals.length > 0
        ? `Linear sequence model learned a stable centroid with strongest movement in ${keySignals
            .map((item) => item.split(":")[0])
            .join(", ")}.`
        : "Linear sequence model has sparse training data and no clear directional signals yet.";

    return {
      summaryText,
      keySignals,
      modelSpecific: {
        centroid,
        trend,
        centroidNorm: Number(vectorNorm(centroid).toFixed(6)),
        trendNorm: Number(vectorNorm(trend).toFixed(6)),
      },
    };
  },
};
