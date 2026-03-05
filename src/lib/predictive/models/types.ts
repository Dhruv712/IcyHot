export type PredictiveStateFrame = {
  entryId: string | null;
  entryDate: string;
  vector: number[];
};

export type PredictiveMemoryCandidate = {
  id: string;
  content: string;
  sourceDate: string;
  activationScore: number;
  hop: number;
  contactIds: string[];
};

export type PredictiveContext = {
  question?: string;
  now: Date;
};

export type PredictiveScore = {
  score: number;
  components: Record<string, number>;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export type ModelArtifactEnvelope = {
  modelKey: string;
  modelVersion: string;
  artifactSchemaVersion: number;
  trainedThroughEntryDate: string;
  metrics: Record<string, number>;
  payload: unknown;
};

export type LoadedModelHandle = {
  modelKey: string;
  modelVersion: string;
  payload: unknown;
};

export interface PredictiveModelAdapter {
  modelKey(): string;
  modelVersion(): string;
  artifactSchemaVersion(): number;
  train(
    frames: PredictiveStateFrame[],
    config: Record<string, unknown>
  ): Promise<ModelArtifactEnvelope>;
  load(artifact: ModelArtifactEnvelope): LoadedModelHandle;
  scoreMemory(
    memory: PredictiveMemoryCandidate,
    context: PredictiveContext,
    handle: LoadedModelHandle
  ): PredictiveScore;
  explain(
    memory: PredictiveMemoryCandidate,
    context: PredictiveContext,
    handle: LoadedModelHandle,
    score: PredictiveScore
  ): string[];
  validateConfig(config: unknown): ValidationResult;
}
