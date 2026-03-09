import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  journalStateFrames,
  predictiveBenchmarkPoints,
  predictiveBenchmarkRuns,
  predictiveBenchmarkWindowPredictions,
  stateTransitionModels,
  userPredictiveStatus,
} from "@/db/schema";
import { resolvePredictiveSelectionForUser, type PredictiveSelectionSource } from "./config";
import { getModel } from "./models/registry";
import type {
  LoadedModelHandle,
  ModelArtifactEnvelope,
  PredictiveLearningSummary,
  PredictiveStateFrame,
} from "./models/types";

const QUICK_CHECKPOINTS = [1, 3, 5, 10, 20] as const;
const FULL_CHECKPOINTS = [1, 3, 5, 10, 15, 20, 30, 40, 50, 75, 100] as const;
const QUICK_SAMPLE_LIMIT = 25;
const FULL_SAMPLE_LIMIT = 200;
const BASELINE_KEY = "persistence_v1";

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

export type PredictiveBenchmarkMode = "quick" | "full";
export type PredictiveBenchmarkTrigger = "nightly" | "manual";

export type PredictiveBenchmarkPointRecord = {
  checkpointSize: number;
  sampleCount: number;
  mae: number;
  mse: number;
  directionalHitRate: number;
  baselineMae: number;
  baselineMse: number;
  baselineDirectionalHitRate: number;
  maeGainPct: number;
  directionalGainPct: number;
  perDimension: {
    dimensions: Array<{
      index: number;
      name: string;
      mae: number;
      mse: number;
      directionalHitRate: number;
      baselineMae: number;
      baselineMse: number;
      baselineDirectionalHitRate: number;
      maeGainPct: number;
      directionalGainPct: number;
    }>;
  };
};

export type PredictiveBenchmarkRunHeader = {
  id: string;
  trigger: PredictiveBenchmarkTrigger;
  mode: PredictiveBenchmarkMode;
  status: "running" | "complete" | "error";
  modelKey: string | null;
  modelVersion: string | null;
  baselineKey: string;
  frameCount: number;
  checkpointSchedule: number[];
  sampleLimit: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  summary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
};

export type PredictiveBenchmarkRunDetail = PredictiveBenchmarkRunHeader & {
  points: PredictiveBenchmarkPointRecord[];
  windowPredictions: PredictiveBenchmarkWindowPredictionRecord[];
};

export type PredictiveBenchmarkWindowPredictionRecord = {
  checkpointSize: number;
  sampleIndex: number;
  targetEntryDate: string;
  predictedVector: number[];
  actualVector: number[];
  baselineVector: number[];
};

export type PredictiveBenchmarkProgressEvent =
  | {
      type: "run_started";
      runId: string;
      mode: PredictiveBenchmarkMode;
      trigger: PredictiveBenchmarkTrigger;
      frameCount: number;
      checkpointSchedule: number[];
      sampleLimit: number;
      modelKey: string;
      modelVersion: string | null;
    }
  | {
      type: "checkpoint_started";
      runId: string;
      checkpointSize: number;
      checkpointIndex: number;
      checkpointTotal: number;
    }
  | {
      type: "checkpoint_complete";
      runId: string;
      checkpointSize: number;
      checkpointIndex: number;
      checkpointTotal: number;
      sampleCount: number;
      metrics: Omit<PredictiveBenchmarkPointRecord, "checkpointSize" | "sampleCount" | "perDimension">;
    }
  | {
      type: "complete";
      runId: string;
      durationMs: number;
      summary: Record<string, unknown>;
    }
  | {
      type: "error";
      runId?: string;
      message: string;
    };

export type PredictiveBenchmarkOutcome =
  | {
      ok: true;
      runId: string;
      frameCount: number;
      checkpointSchedule: number[];
      sampleLimit: number;
      summary: Record<string, unknown>;
    }
  | {
      ok: false;
      code:
        | "insufficient_frames"
        | "invalid_model_config"
        | "predictive_storage_missing"
        | "runtime_error";
      message: string;
      runId?: string;
      frameCount: number;
      checkpointSchedule: number[];
      sampleLimit: number;
    };

export type PredictiveOverviewData = {
  status: {
    framesCount: number;
    backfillCompleteAt: string | null;
    lastEntryProcessedAt: string | null;
    lastTrainedAt: string | null;
    lastScoredAt: string | null;
    activeModelKey: string | null;
    activeModelVersion: string | null;
    updatedAt: string | null;
  };
  selection: {
    modelKey: string;
    source: PredictiveSelectionSource;
  };
  latestArtifact: {
    modelKey: string;
    modelVersion: string;
    trainedThroughEntryDate: string;
    metrics: Record<string, number>;
    createdAt: string;
  } | null;
  learningSummary: PredictiveLearningSummary | null;
  latestRun: PredictiveBenchmarkRunDetail | null;
  recentRuns: PredictiveBenchmarkRunHeader[];
};

type WindowSample = {
  history: PredictiveStateFrame[];
  target: PredictiveStateFrame;
};

type DimensionAccumulator = {
  absError: number;
  sqError: number;
  directionalHits: number;
  baselineAbsError: number;
  baselineSqError: number;
  baselineDirectionalHits: number;
  count: number;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => toNumber(item, 0));
  }
  if (typeof value === "string") {
    try {
      return parseVector(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function parseArtifact(value: unknown): ModelArtifactEnvelope | null {
  const parsed = parseObject(value);
  if (!parsed) return null;
  return {
    modelKey: String(parsed.modelKey ?? ""),
    modelVersion: String(parsed.modelVersion ?? ""),
    artifactSchemaVersion: toNumber(parsed.artifactSchemaVersion, 1),
    trainedThroughEntryDate: String(parsed.trainedThroughEntryDate ?? ""),
    metrics:
      parsed.metrics && typeof parsed.metrics === "object" && !Array.isArray(parsed.metrics)
        ? (parsed.metrics as Record<string, number>)
        : {},
    payload: parsed.payload,
  };
}

function parseNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Math.floor(toNumber(item, 0))).filter((item) => item > 0);
  }
  if (typeof value === "string") {
    try {
      return parseNumberArray(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function direction(value: number): -1 | 0 | 1 {
  if (value > 1e-9) return 1;
  if (value < -1e-9) return -1;
  return 0;
}

function ensureLength(vector: number[], dimension: number, fallbackVector: number[]): number[] {
  return Array.from({ length: dimension }, (_, index) => {
    const fallback = toNumber(fallbackVector[index], 0);
    return toNumber(vector[index], fallback);
  });
}

function buildSlidingWindows(frames: PredictiveStateFrame[], checkpointSize: number): WindowSample[] {
  const windows: WindowSample[] = [];
  for (let start = 0; start + checkpointSize < frames.length; start++) {
    const history = frames.slice(start, start + checkpointSize);
    const target = frames[start + checkpointSize];
    if (!target || history.length !== checkpointSize) continue;
    windows.push({ history, target });
  }
  return windows;
}

function downsampleDeterministically<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return [items[0]];

  const selected: T[] = [];
  const maxIndex = items.length - 1;
  for (let i = 0; i < limit; i++) {
    const index = Math.floor((i * maxIndex) / (limit - 1));
    selected.push(items[index]);
  }
  return selected;
}

function getCheckpointTemplate(mode: PredictiveBenchmarkMode): readonly number[] {
  return mode === "quick" ? QUICK_CHECKPOINTS : FULL_CHECKPOINTS;
}

export function getSampleLimitForMode(mode: PredictiveBenchmarkMode): number {
  return mode === "quick" ? QUICK_SAMPLE_LIMIT : FULL_SAMPLE_LIMIT;
}

export function buildCheckpointSchedule(mode: PredictiveBenchmarkMode, frameCount: number): number[] {
  return getCheckpointTemplate(mode).filter((size) => size < frameCount);
}

function createDimensionAccumulators(dimension: number): DimensionAccumulator[] {
  return Array.from({ length: dimension }, () => ({
    absError: 0,
    sqError: 0,
    directionalHits: 0,
    baselineAbsError: 0,
    baselineSqError: 0,
    baselineDirectionalHits: 0,
    count: 0,
  }));
}

function mapRunHeader(row: typeof predictiveBenchmarkRuns.$inferSelect): PredictiveBenchmarkRunHeader {
  return {
    id: row.id,
    trigger: row.trigger,
    mode: row.mode,
    status: row.status,
    modelKey: row.modelKey,
    modelVersion: row.modelVersion,
    baselineKey: row.baselineKey,
    frameCount: row.frameCount,
    checkpointSchedule: parseNumberArray(row.checkpointSchedule),
    sampleLimit: row.sampleLimit,
    startedAt: toIso(row.startedAt) ?? new Date(0).toISOString(),
    completedAt: toIso(row.completedAt),
    durationMs: row.durationMs,
    summary: parseObject(row.summaryJson),
    errorMessage: row.errorMessage,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

function mapPointRow(row: typeof predictiveBenchmarkPoints.$inferSelect): PredictiveBenchmarkPointRecord {
  const parsedPerDimension = parseObject(row.perDimensionJson);
  const dimensionsRaw = Array.isArray(parsedPerDimension?.dimensions)
    ? (parsedPerDimension?.dimensions as Array<Record<string, unknown>>)
    : [];

  return {
    checkpointSize: row.checkpointSize,
    sampleCount: row.sampleCount,
    mae: row.mae,
    mse: row.mse,
    directionalHitRate: row.directionalHitRate,
    baselineMae: row.baselineMae,
    baselineMse: row.baselineMse,
    baselineDirectionalHitRate: row.baselineDirectionalHitRate,
    maeGainPct: row.maeGainPct,
    directionalGainPct: row.directionalGainPct,
    perDimension: {
      dimensions: dimensionsRaw.map((dimension, index) => ({
        index: Math.floor(toNumber(dimension.index, index)),
        name: String(dimension.name ?? CORE10_DIMENSIONS[index] ?? `dim_${index + 1}`),
        mae: toNumber(dimension.mae, 0),
        mse: toNumber(dimension.mse, 0),
        directionalHitRate: toNumber(dimension.directionalHitRate, 0),
        baselineMae: toNumber(dimension.baselineMae, 0),
        baselineMse: toNumber(dimension.baselineMse, 0),
        baselineDirectionalHitRate: toNumber(dimension.baselineDirectionalHitRate, 0),
        maeGainPct: toNumber(dimension.maeGainPct, 0),
        directionalGainPct: toNumber(dimension.directionalGainPct, 0),
      })),
    },
  };
}

function mapWindowPredictionRow(
  row: typeof predictiveBenchmarkWindowPredictions.$inferSelect
): PredictiveBenchmarkWindowPredictionRecord {
  return {
    checkpointSize: row.checkpointSize,
    sampleIndex: row.sampleIndex,
    targetEntryDate: row.targetEntryDate,
    predictedVector: parseVector(row.predictedVectorJson),
    actualVector: parseVector(row.actualVectorJson),
    baselineVector: parseVector(row.baselineVectorJson),
  };
}

function isMissingPredictiveStorage(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("predictive_benchmark_runs") ||
    message.includes("predictive_benchmark_points") ||
    message.includes("predictive_benchmark_window_predictions") ||
    message.includes("state_transition_models") ||
    message.includes("user_predictive_status") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    message.includes("undefined table")
  );
}

function summarizeRun(points: PredictiveBenchmarkPointRecord[]): Record<string, unknown> {
  if (points.length === 0) {
    return {
      checkpointsEvaluated: 0,
      samplesEvaluated: 0,
      bestMae: null,
      bestDirectional: null,
      avgMaeGainPct: 0,
      avgDirectionalGainPct: 0,
    };
  }

  const bestMae = points.reduce((best, point) => (point.mae < best.mae ? point : best), points[0]);
  const bestDirectional = points.reduce(
    (best, point) =>
      point.directionalHitRate > best.directionalHitRate ? point : best,
    points[0]
  );

  const samplesEvaluated = points.reduce((sum, point) => sum + point.sampleCount, 0);
  const avgMaeGainPct = points.reduce((sum, point) => sum + point.maeGainPct, 0) / points.length;
  const avgDirectionalGainPct =
    points.reduce((sum, point) => sum + point.directionalGainPct, 0) / points.length;

  return {
    checkpointsEvaluated: points.length,
    samplesEvaluated,
    bestMae: {
      checkpointSize: bestMae.checkpointSize,
      mae: bestMae.mae,
      baselineMae: bestMae.baselineMae,
      maeGainPct: bestMae.maeGainPct,
    },
    bestDirectional: {
      checkpointSize: bestDirectional.checkpointSize,
      directionalHitRate: bestDirectional.directionalHitRate,
      baselineDirectionalHitRate: bestDirectional.baselineDirectionalHitRate,
      directionalGainPct: bestDirectional.directionalGainPct,
    },
    avgMaeGainPct: round(avgMaeGainPct),
    avgDirectionalGainPct: round(avgDirectionalGainPct),
  };
}

async function fetchOrderedFrames(userId: string): Promise<PredictiveStateFrame[]> {
  const rows = await db
    .select({
      entryId: journalStateFrames.entryId,
      entryDate: journalStateFrames.entryDate,
      stateVector: journalStateFrames.stateVector,
    })
    .from(journalStateFrames)
    .where(eq(journalStateFrames.userId, userId))
    .orderBy(journalStateFrames.entryDate);

  return rows
    .map((row) => ({
      entryId: row.entryId,
      entryDate: row.entryDate,
      vector: parseVector(row.stateVector),
    }))
    .filter((frame) => frame.vector.length > 0);
}

async function resolveLatestModelForUser(userId: string, modelKey: string): Promise<{
  artifact: ModelArtifactEnvelope | null;
  modelVersion: string | null;
  createdAt: string | null;
}> {
  const [latest] = await db
    .select({
      modelVersion: stateTransitionModels.modelVersion,
      artifactJson: stateTransitionModels.artifactJson,
      createdAt: stateTransitionModels.createdAt,
    })
    .from(stateTransitionModels)
    .where(and(eq(stateTransitionModels.userId, userId), eq(stateTransitionModels.modelKey, modelKey)))
    .orderBy(desc(stateTransitionModels.createdAt))
    .limit(1);

  return {
    artifact: latest ? parseArtifact(latest.artifactJson) : null,
    modelVersion: latest?.modelVersion ?? null,
    createdAt: toIso(latest?.createdAt) ?? null,
  };
}

async function evaluateCheckpoint(params: {
  adapter: ReturnType<typeof getModel>;
  checkpointSize: number;
  frames: PredictiveStateFrame[];
  config: Record<string, unknown>;
  sampleLimit: number;
}): Promise<{
  point: PredictiveBenchmarkPointRecord;
  windowPredictions: PredictiveBenchmarkWindowPredictionRecord[];
}> {
  const windows = buildSlidingWindows(params.frames, params.checkpointSize);
  const sampledWindows = downsampleDeterministically(windows, params.sampleLimit);
  const sampleCount = sampledWindows.length;
  const firstWindow = sampledWindows[0];
  const dimension = firstWindow?.target.vector.length ?? params.frames[0]?.vector.length ?? 0;
  const dimensions = createDimensionAccumulators(dimension);
  const windowPredictions: PredictiveBenchmarkWindowPredictionRecord[] = [];

  let totalAbsError = 0;
  let totalSqError = 0;
  let totalDirectionalHits = 0;
  let totalBaselineAbsError = 0;
  let totalBaselineSqError = 0;
  let totalBaselineDirectionalHits = 0;
  let totalCount = 0;
  for (let sampleIndex = 0; sampleIndex < sampledWindows.length; sampleIndex++) {
    const window = sampledWindows[sampleIndex];
    if (!window) continue;
    const artifact = await params.adapter.train(window.history, params.config);
    const handle = params.adapter.load(artifact);
    const previous = window.history.at(-1)?.vector ?? [];
    const predictedRaw = params.adapter.predictNextState(window.history, params.config, handle);
    const predicted = ensureLength(predictedRaw, dimension, previous);
    const baseline = ensureLength(previous, dimension, previous);
    const actual = ensureLength(window.target.vector, dimension, previous);
    const previousAligned = ensureLength(previous, dimension, previous);

    windowPredictions.push({
      checkpointSize: params.checkpointSize,
      sampleIndex,
      targetEntryDate: window.target.entryDate,
      predictedVector: predicted.map(round),
      actualVector: actual.map(round),
      baselineVector: baseline.map(round),
    });

    for (let index = 0; index < dimension; index++) {
      const predictedValue = predicted[index];
      const baselineValue = baseline[index];
      const actualValue = actual[index];
      const previousValue = previousAligned[index];

      const absError = Math.abs(predictedValue - actualValue);
      const sqError = (predictedValue - actualValue) ** 2;
      const baselineAbsError = Math.abs(baselineValue - actualValue);
      const baselineSqError = (baselineValue - actualValue) ** 2;

      const directionalHit =
        direction(predictedValue - previousValue) === direction(actualValue - previousValue)
          ? 1
          : 0;
      const baselineDirectionalHit =
        direction(baselineValue - previousValue) === direction(actualValue - previousValue)
          ? 1
          : 0;

      totalAbsError += absError;
      totalSqError += sqError;
      totalDirectionalHits += directionalHit;
      totalBaselineAbsError += baselineAbsError;
      totalBaselineSqError += baselineSqError;
      totalBaselineDirectionalHits += baselineDirectionalHit;
      totalCount += 1;

      const accumulator = dimensions[index];
      accumulator.absError += absError;
      accumulator.sqError += sqError;
      accumulator.directionalHits += directionalHit;
      accumulator.baselineAbsError += baselineAbsError;
      accumulator.baselineSqError += baselineSqError;
      accumulator.baselineDirectionalHits += baselineDirectionalHit;
      accumulator.count += 1;
    }
  }

  const safeCount = Math.max(1, totalCount);
  const mae = totalAbsError / safeCount;
  const mse = totalSqError / safeCount;
  const directionalHitRate = totalDirectionalHits / safeCount;
  const baselineMae = totalBaselineAbsError / safeCount;
  const baselineMse = totalBaselineSqError / safeCount;
  const baselineDirectionalHitRate = totalBaselineDirectionalHits / safeCount;
  const maeGainPct = baselineMae > 1e-9 ? (baselineMae - mae) / baselineMae : 0;
  const directionalGainPct = directionalHitRate - baselineDirectionalHitRate;

  const perDimension = dimensions.map((dimensionAccumulator, index) => {
    const count = Math.max(1, dimensionAccumulator.count);
    const dimensionMae = dimensionAccumulator.absError / count;
    const dimensionMse = dimensionAccumulator.sqError / count;
    const dimensionDirectional = dimensionAccumulator.directionalHits / count;
    const dimensionBaselineMae = dimensionAccumulator.baselineAbsError / count;
    const dimensionBaselineMse = dimensionAccumulator.baselineSqError / count;
    const dimensionBaselineDirectional = dimensionAccumulator.baselineDirectionalHits / count;
    const dimensionMaeGain =
      dimensionBaselineMae > 1e-9
        ? (dimensionBaselineMae - dimensionMae) / dimensionBaselineMae
        : 0;
    const dimensionDirectionalGain = dimensionDirectional - dimensionBaselineDirectional;

    return {
      index,
      name: CORE10_DIMENSIONS[index] ?? `dim_${index + 1}`,
      mae: round(dimensionMae),
      mse: round(dimensionMse),
      directionalHitRate: round(dimensionDirectional),
      baselineMae: round(dimensionBaselineMae),
      baselineMse: round(dimensionBaselineMse),
      baselineDirectionalHitRate: round(dimensionBaselineDirectional),
      maeGainPct: round(dimensionMaeGain),
      directionalGainPct: round(dimensionDirectionalGain),
    };
  });

  return {
    point: {
      checkpointSize: params.checkpointSize,
      sampleCount,
      mae: round(mae),
      mse: round(mse),
      directionalHitRate: round(clamp(directionalHitRate, 0, 1)),
      baselineMae: round(baselineMae),
      baselineMse: round(baselineMse),
      baselineDirectionalHitRate: round(clamp(baselineDirectionalHitRate, 0, 1)),
      maeGainPct: round(maeGainPct),
      directionalGainPct: round(directionalGainPct),
      perDimension: {
        dimensions: perDimension,
      },
    },
    windowPredictions,
  };
}

export async function runPredictiveBenchmarkForUser(params: {
  userId: string;
  trigger: PredictiveBenchmarkTrigger;
  mode: PredictiveBenchmarkMode;
  onProgress?: (event: PredictiveBenchmarkProgressEvent) => void;
}): Promise<PredictiveBenchmarkOutcome> {
  let runId: string | undefined;
  let frameCount = 0;
  const sampleLimit = getSampleLimitForMode(params.mode);
  let checkpointSchedule: number[] = [];

  try {
    const selection = await resolvePredictiveSelectionForUser(params.userId);
    const adapter = getModel(selection.modelKey);
    const validation = adapter.validateConfig(selection.config);
    const frames = await fetchOrderedFrames(params.userId);
    frameCount = frames.length;
    checkpointSchedule = buildCheckpointSchedule(params.mode, frameCount);

    if (frameCount < 2 || checkpointSchedule.length === 0) {
      return {
        ok: false,
        code: "insufficient_frames",
        message: `Need at least 2 state frames to benchmark. Found ${frameCount}.`,
        frameCount,
        checkpointSchedule,
        sampleLimit,
      };
    }

    if (!validation.ok) {
      return {
        ok: false,
        code: "invalid_model_config",
        message: validation.errors.join(" "),
        frameCount,
        checkpointSchedule,
        sampleLimit,
      };
    }

    const latestModel = await resolveLatestModelForUser(params.userId, selection.modelKey);
    const now = new Date();
    const [runRow] = await db
      .insert(predictiveBenchmarkRuns)
      .values({
        userId: params.userId,
        trigger: params.trigger,
        mode: params.mode,
        status: "running",
        modelKey: selection.modelKey,
        modelVersion: latestModel.modelVersion ?? null,
        baselineKey: BASELINE_KEY,
        frameCount,
        checkpointSchedule,
        sampleLimit,
        startedAt: now,
        createdAt: now,
      })
      .returning({ id: predictiveBenchmarkRuns.id });
    runId = runRow.id;
    const persistedRunId = runRow.id;

    params.onProgress?.({
      type: "run_started",
      runId: persistedRunId,
      mode: params.mode,
      trigger: params.trigger,
      frameCount,
      checkpointSchedule,
      sampleLimit,
      modelKey: selection.modelKey,
      modelVersion: latestModel.modelVersion,
    });

    const points: PredictiveBenchmarkPointRecord[] = [];

    for (let index = 0; index < checkpointSchedule.length; index++) {
      const checkpointSize = checkpointSchedule[index];
      params.onProgress?.({
        type: "checkpoint_started",
        runId: persistedRunId,
        checkpointSize,
        checkpointIndex: index,
        checkpointTotal: checkpointSchedule.length,
      });

      const { point, windowPredictions } = await evaluateCheckpoint({
        adapter,
        checkpointSize,
        frames,
        config: selection.config,
        sampleLimit,
      });

      points.push(point);

      await db.insert(predictiveBenchmarkPoints).values({
        runId: persistedRunId,
        userId: params.userId,
        checkpointSize: point.checkpointSize,
        sampleCount: point.sampleCount,
        mae: point.mae,
        mse: point.mse,
        directionalHitRate: point.directionalHitRate,
        baselineMae: point.baselineMae,
        baselineMse: point.baselineMse,
        baselineDirectionalHitRate: point.baselineDirectionalHitRate,
        maeGainPct: point.maeGainPct,
        directionalGainPct: point.directionalGainPct,
        perDimensionJson: point.perDimension,
        createdAt: new Date(),
      });

      if (windowPredictions.length > 0) {
        const createdAt = new Date();
        await db.insert(predictiveBenchmarkWindowPredictions).values(
          windowPredictions.map((windowPrediction) => ({
            runId: persistedRunId,
            userId: params.userId,
            checkpointSize: point.checkpointSize,
            sampleIndex: windowPrediction.sampleIndex,
            targetEntryDate: windowPrediction.targetEntryDate,
            predictedVectorJson: windowPrediction.predictedVector,
            actualVectorJson: windowPrediction.actualVector,
            baselineVectorJson: windowPrediction.baselineVector,
            createdAt,
          }))
        );
      }

      params.onProgress?.({
        type: "checkpoint_complete",
        runId: persistedRunId,
        checkpointSize,
        checkpointIndex: index,
        checkpointTotal: checkpointSchedule.length,
        sampleCount: point.sampleCount,
        metrics: {
          mae: point.mae,
          mse: point.mse,
          directionalHitRate: point.directionalHitRate,
          baselineMae: point.baselineMae,
          baselineMse: point.baselineMse,
          baselineDirectionalHitRate: point.baselineDirectionalHitRate,
          maeGainPct: point.maeGainPct,
          directionalGainPct: point.directionalGainPct,
        },
      });
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - now.getTime();
    const summary = summarizeRun(points);

    await db
      .update(predictiveBenchmarkRuns)
      .set({
        status: "complete",
        completedAt,
        durationMs,
        summaryJson: summary,
        errorMessage: null,
      })
      .where(eq(predictiveBenchmarkRuns.id, persistedRunId));

    params.onProgress?.({
      type: "complete",
      runId: persistedRunId,
      durationMs,
      summary,
    });

    return {
      ok: true,
      runId: persistedRunId,
      frameCount,
      checkpointSchedule,
      sampleLimit,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Benchmark run failed";
    if (runId) {
      try {
        await db
          .update(predictiveBenchmarkRuns)
          .set({
            status: "error",
            completedAt: new Date(),
            durationMs: null,
            errorMessage: message,
          })
          .where(eq(predictiveBenchmarkRuns.id, runId));
      } catch {
        // Ignore secondary persistence failures and surface the primary error.
      }
    }

    if (isMissingPredictiveStorage(error)) {
      return {
        ok: false,
        code: "predictive_storage_missing",
        message: "Playground storage is not ready yet. Run migration 0009_predictive_benchmarks.sql.",
        runId,
        frameCount,
        checkpointSchedule,
        sampleLimit,
      };
    }

    return {
      ok: false,
      code: "runtime_error",
      message,
      runId,
      frameCount,
      checkpointSchedule,
      sampleLimit,
    };
  }
}

export async function listPredictiveBenchmarkRunsForUser(params: {
  userId: string;
  limit?: number;
  offset?: number;
}): Promise<PredictiveBenchmarkRunHeader[]> {
  const limit = clamp(Math.floor(params.limit ?? 20), 1, 100);
  const offset = Math.max(0, Math.floor(params.offset ?? 0));

  const rows = await db
    .select()
    .from(predictiveBenchmarkRuns)
    .where(eq(predictiveBenchmarkRuns.userId, params.userId))
    .orderBy(desc(predictiveBenchmarkRuns.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(mapRunHeader);
}

export async function getPredictiveBenchmarkRunForUser(params: {
  userId: string;
  runId: string;
  includeWindowPredictions?: boolean;
}): Promise<PredictiveBenchmarkRunDetail | null> {
  const [runRow] = await db
    .select()
    .from(predictiveBenchmarkRuns)
    .where(
      and(
        eq(predictiveBenchmarkRuns.id, params.runId),
        eq(predictiveBenchmarkRuns.userId, params.userId)
      )
    )
    .limit(1);

  if (!runRow) return null;

  const pointRows = await db
    .select()
    .from(predictiveBenchmarkPoints)
    .where(
      and(
        eq(predictiveBenchmarkPoints.runId, params.runId),
        eq(predictiveBenchmarkPoints.userId, params.userId)
      )
    )
    .orderBy(predictiveBenchmarkPoints.checkpointSize);

  let windowPredictionRows: typeof predictiveBenchmarkWindowPredictions.$inferSelect[] = [];
  if (params.includeWindowPredictions !== false) {
    windowPredictionRows = await db
      .select()
      .from(predictiveBenchmarkWindowPredictions)
      .where(
        and(
          eq(predictiveBenchmarkWindowPredictions.runId, params.runId),
          eq(predictiveBenchmarkWindowPredictions.userId, params.userId)
        )
      )
      .orderBy(
        predictiveBenchmarkWindowPredictions.checkpointSize,
        predictiveBenchmarkWindowPredictions.sampleIndex
      );
  }

  return {
    ...mapRunHeader(runRow),
    points: pointRows.map(mapPointRow),
    windowPredictions: windowPredictionRows.map(mapWindowPredictionRow),
  };
}

function fallbackArtifactEnvelope(handle: LoadedModelHandle): ModelArtifactEnvelope {
  return {
    modelKey: handle.modelKey,
    modelVersion: handle.modelVersion,
    artifactSchemaVersion: 1,
    trainedThroughEntryDate: new Date().toISOString().slice(0, 10),
    metrics: {},
    payload: handle.payload,
  };
}

export async function getPredictiveOverviewForUser(userId: string): Promise<PredictiveOverviewData> {
  const [status] = await db
    .select()
    .from(userPredictiveStatus)
    .where(eq(userPredictiveStatus.userId, userId))
    .limit(1);

  const selection = await resolvePredictiveSelectionForUser(userId);
  const adapter = getModel(selection.modelKey);
  const latestModel = await resolveLatestModelForUser(userId, selection.modelKey);
  const artifact = latestModel.artifact;
  const modelHandle = artifact
    ? adapter.load(artifact)
    : adapter.load(
        fallbackArtifactEnvelope({
          modelKey: selection.modelKey,
          modelVersion: adapter.modelVersion(),
          payload: {},
        })
      );

  const recentRuns = await listPredictiveBenchmarkRunsForUser({ userId, limit: 12, offset: 0 });
  const latestRunId = recentRuns[0]?.id;
  const latestRun = latestRunId
    ? await getPredictiveBenchmarkRunForUser({
        userId,
        runId: latestRunId,
        includeWindowPredictions: false,
      })
    : null;

  return {
    status: {
      framesCount: status?.framesCount ?? 0,
      backfillCompleteAt: toIso(status?.backfillCompleteAt),
      lastEntryProcessedAt: toIso(status?.lastEntryProcessedAt),
      lastTrainedAt: toIso(status?.lastTrainedAt),
      lastScoredAt: toIso(status?.lastScoredAt),
      activeModelKey: status?.activeModelKey ?? null,
      activeModelVersion: status?.activeModelVersion ?? null,
      updatedAt: toIso(status?.updatedAt),
    },
    selection: {
      modelKey: selection.modelKey,
      source: selection.source,
    },
    latestArtifact: artifact
      ? {
          modelKey: artifact.modelKey,
          modelVersion: artifact.modelVersion,
          trainedThroughEntryDate: artifact.trainedThroughEntryDate,
          metrics: artifact.metrics,
          createdAt: latestModel.createdAt ?? new Date().toISOString(),
        }
      : null,
    learningSummary: adapter.summarizeLearning(modelHandle),
    latestRun,
    recentRuns,
  };
}

export function isPredictiveBenchmarkStorageMissing(error: unknown): boolean {
  return isMissingPredictiveStorage(error);
}
