export type PredictiveBenchmarkPoint = {
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

export type PredictiveBenchmarkRun = {
  id: string;
  trigger: "nightly" | "manual";
  mode: "quick" | "full";
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
  points?: PredictiveBenchmarkPoint[];
  windowPredictions?: PredictiveBenchmarkWindowPrediction[];
};

export type PredictiveBenchmarkWindowPrediction = {
  checkpointSize: number;
  sampleIndex: number;
  targetEntryDate: string;
  predictedVector: number[];
  actualVector: number[];
  baselineVector: number[];
};

export type PredictiveOverview = {
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
    source: "user_override" | "global_override" | "env" | "fallback";
  };
  latestArtifact: {
    modelKey: string;
    modelVersion: string;
    trainedThroughEntryDate: string;
    metrics: Record<string, number>;
    createdAt: string;
  } | null;
  learningSummary: {
    summaryText: string;
    keySignals: string[];
    modelSpecific: Record<string, unknown>;
  } | null;
  latestRun: PredictiveBenchmarkRun | null;
  recentRuns: PredictiveBenchmarkRun[];
};

export type PredictiveBenchmarkProgressEvent =
  | {
      type: "run_started";
      runId: string;
      mode: "quick" | "full";
      trigger: "nightly" | "manual";
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
      metrics: {
        mae: number;
        mse: number;
        directionalHitRate: number;
        baselineMae: number;
        baselineMse: number;
        baselineDirectionalHitRate: number;
        maeGainPct: number;
        directionalGainPct: number;
      };
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
