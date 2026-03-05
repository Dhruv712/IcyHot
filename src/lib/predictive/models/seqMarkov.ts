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

const MODEL_KEY = "seq_markov_v1";
const MODEL_VERSION = "1.0.0";
const ARTIFACT_SCHEMA_VERSION = 1;

type SeqMarkovConfig = {
  recencyWeight: number;
  semanticWeight: number;
  hopPenalty: number;
};

type SeqMarkovPayload = {
  config: SeqMarkovConfig;
  transition: number[][];
  expectedNextEnergy: number;
};

const DEFAULT_CONFIG: SeqMarkovConfig = {
  recencyWeight: 0.25,
  semanticWeight: 0.5,
  hopPenalty: 0.2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseConfig(config: unknown): SeqMarkovConfig {
  const incoming = (config ?? {}) as Partial<SeqMarkovConfig>;
  return {
    recencyWeight:
      typeof incoming.recencyWeight === "number"
        ? incoming.recencyWeight
        : DEFAULT_CONFIG.recencyWeight,
    semanticWeight:
      typeof incoming.semanticWeight === "number"
        ? incoming.semanticWeight
        : DEFAULT_CONFIG.semanticWeight,
    hopPenalty:
      typeof incoming.hopPenalty === "number"
        ? incoming.hopPenalty
        : DEFAULT_CONFIG.hopPenalty,
  };
}

function normalizeActivation(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + 1);
}

function recencySignal(sourceDate: string, now: Date): number {
  const parsed = new Date(`${sourceDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 0.5;
  const days = Math.max(0, (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  return clamp(1 - days / 180, 0, 1);
}

function averageAbs(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
}

function stateBucket(vector: number[]): number {
  const energy = averageAbs(vector);
  if (energy < 0.2) return 0;
  if (energy < 0.45) return 1;
  return 2;
}

function estimateTransitions(frames: PredictiveStateFrame[]): number[][] {
  const matrix = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ];

  const ordered = [...frames].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  for (let i = 1; i < ordered.length; i++) {
    const from = stateBucket(ordered[i - 1]?.vector ?? []);
    const to = stateBucket(ordered[i]?.vector ?? []);
    matrix[from][to] += 1;
  }

  return matrix.map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0) || 1;
    return row.map((value) => value / total);
  });
}

function expectedNextEnergy(transition: number[][]): number {
  const neutral = transition[1] ?? [1 / 3, 1 / 3, 1 / 3];
  // Low, medium, high mapped to 0.2 / 0.5 / 0.85
  return neutral[0] * 0.2 + neutral[1] * 0.5 + neutral[2] * 0.85;
}

function energyFromTransitionRow(row: number[]): number {
  const low = row[0] ?? 1 / 3;
  const mid = row[1] ?? 1 / 3;
  const high = row[2] ?? 1 / 3;
  return clamp(low * 0.2 + mid * 0.5 + high * 0.85, 0, 1);
}

function dominantTransitionLabel(row: number[]): string {
  const index = row.indexOf(Math.max(...row));
  if (index === 0) return "low-intensity";
  if (index === 1) return "moderate-intensity";
  return "high-intensity";
}

export const seqMarkovModel: PredictiveModelAdapter = {
  modelKey: () => MODEL_KEY,
  modelVersion: () => MODEL_VERSION,
  artifactSchemaVersion: () => ARTIFACT_SCHEMA_VERSION,
  validateConfig(config: unknown): ValidationResult {
    const parsed = parseConfig(config);
    const errors: string[] = [];

    if (parsed.recencyWeight < 0 || parsed.recencyWeight > 1) {
      errors.push("recencyWeight must be between 0 and 1.");
    }
    if (parsed.semanticWeight < 0 || parsed.semanticWeight > 1) {
      errors.push("semanticWeight must be between 0 and 1.");
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
    const transition = estimateTransitions(frames);
    const nextEnergy = expectedNextEnergy(transition);
    const ordered = [...frames].sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    return {
      modelKey: MODEL_KEY,
      modelVersion: MODEL_VERSION,
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      trainedThroughEntryDate: ordered.at(-1)?.entryDate ?? new Date().toISOString().slice(0, 10),
      metrics: {
        frameCount: ordered.length,
        expectedNextEnergy: Number(nextEnergy.toFixed(6)),
      },
      payload: {
        config: parsed,
        transition,
        expectedNextEnergy: nextEnergy,
      } satisfies SeqMarkovPayload,
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
    const payload = (handle.payload ?? {}) as Partial<SeqMarkovPayload>;
    const config = parseConfig(payload.config);

    const semantic = normalizeActivation(memory.activationScore);
    const recency = recencySignal(memory.sourceDate, context.now);
    const stateBias = clamp(payload.expectedNextEnergy ?? 0.5, 0, 1);
    const hopPenalty = clamp(memory.hop * config.hopPenalty, 0, 0.8);

    const residualWeight = Math.max(0, 1 - config.semanticWeight - config.recencyWeight);
    const denominator = config.semanticWeight + config.recencyWeight + residualWeight;

    const weighted =
      denominator > 0
        ? (semantic * config.semanticWeight + recency * config.recencyWeight + stateBias * residualWeight) /
          denominator
        : 0;

    const score = clamp(weighted - hopPenalty, 0, 1);

    return {
      score: Number(score.toFixed(6)),
      components: {
        semantic: Number(semantic.toFixed(6)),
        recency: Number(recency.toFixed(6)),
        stateBias: Number(stateBias.toFixed(6)),
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
    if (score.components.stateBias >= 0.65) {
      reasons.push("Model expects near-term continuation of the current trajectory.");
    }
    if (score.components.semantic >= 0.65) {
      reasons.push("Strong semantic match with your current question.");
    }
    if (score.components.recency >= 0.65) {
      reasons.push("Recent memory likely to influence what happens next.");
    }
    if (reasons.length === 0) {
      reasons.push("Moderate utility based on state-transition and semantic alignment.");
    }

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

    const payload = (handle.payload ?? {}) as Partial<SeqMarkovPayload>;
    const transition = Array.isArray(payload.transition)
      ? payload.transition.map((row) =>
          Array.isArray(row)
            ? row.map((value) => (typeof value === "number" ? value : Number(value)))
            : []
        )
      : [];

    const fallback = history.at(-1)?.vector ?? [];
    if (fallback.length === 0) return [];

    const currentBucket = stateBucket(fallback);
    const row = transition[currentBucket] ?? transition[1] ?? [1 / 3, 1 / 3, 1 / 3];
    const projectedEnergy = energyFromTransitionRow(row);
    const next = [...fallback];

    next[0] = Number(projectedEnergy.toFixed(6));
    next[8] = Number(clamp(projectedEnergy * 0.82, 0, 1).toFixed(6));
    next[7] = Number(clamp(1 - projectedEnergy * 0.75, 0, 1).toFixed(6));

    return next.map((value) => Number(clamp(value ?? 0, 0, 1).toFixed(6)));
  },
  summarizeLearning(handle: LoadedModelHandle): PredictiveLearningSummary {
    const payload = (handle.payload ?? {}) as Partial<SeqMarkovPayload>;
    const transition = Array.isArray(payload.transition)
      ? payload.transition.map((row) =>
          Array.isArray(row)
            ? row.map((value) => (typeof value === "number" ? value : Number(value)))
            : []
        )
      : [];

    const lowRow = transition[0] ?? [1 / 3, 1 / 3, 1 / 3];
    const neutralRow = transition[1] ?? [1 / 3, 1 / 3, 1 / 3];
    const highRow = transition[2] ?? [1 / 3, 1 / 3, 1 / 3];

    const keySignals = [
      `Low-energy state tends toward ${dominantTransitionLabel(lowRow)}.`,
      `Neutral state tends toward ${dominantTransitionLabel(neutralRow)}.`,
      `High-energy state tends toward ${dominantTransitionLabel(highRow)}.`,
    ];

    return {
      summaryText:
        "Markov sequence model learned transition probabilities between low, medium, and high emotional-energy states.",
      keySignals,
      modelSpecific: {
        transition,
        expectedNextEnergy: Number((payload.expectedNextEnergy ?? energyFromTransitionRow(neutralRow)).toFixed(6)),
      },
    };
  },
};
