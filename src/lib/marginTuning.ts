export interface MarginClientTuning {
  debounceMs: number;
  minParagraphLength: number;
  minParagraphWords: number;
  minQueryGapMs: number;
  annotationCooldownMs: number;
  maxAnnotationsPerEntry: number;
  minParagraphGap: number;
}

export interface MarginServerTuning {
  minParagraphWords: number;
  minActivationScore: number;
  minTopActivation: number;
  minTopGap: number;
  strongTopOverride: number;
  minModelConfidence: number;
  maxMemoriesContext: number;
  maxImplicationsContext: number;
}

export interface MarginTuningSettings {
  client: MarginClientTuning;
  server: MarginServerTuning;
  promptAddendum: string;
  promptOverride: string;
}

export const MARGIN_TUNING_STORAGE_KEY = "icyhot-margin-tuning-v1";

export const DEFAULT_MARGIN_CLIENT_TUNING: MarginClientTuning = {
  debounceMs: 3500,
  minParagraphLength: 30,
  minParagraphWords: 8,
  minQueryGapMs: 7000,
  annotationCooldownMs: 20000,
  maxAnnotationsPerEntry: 8,
  minParagraphGap: 0,
};

export const DEFAULT_MARGIN_SERVER_TUNING: MarginServerTuning = {
  minParagraphWords: 6,
  minActivationScore: 0.09,
  minTopActivation: 0.11,
  minTopGap: 0.015,
  strongTopOverride: 0.17,
  minModelConfidence: 0.72,
  maxMemoriesContext: 4,
  maxImplicationsContext: 2,
};

export const DEFAULT_MARGIN_TUNING: MarginTuningSettings = {
  client: DEFAULT_MARGIN_CLIENT_TUNING,
  server: DEFAULT_MARGIN_SERVER_TUNING,
  promptAddendum: "",
  promptOverride: "",
};

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: unknown, maxLen = 12000): string {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLen);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

export function coerceMarginTuning(input: unknown): MarginTuningSettings {
  const root = asRecord(input);
  const client = asRecord(root.client);
  const server = asRecord(root.server);

  return {
    client: {
      debounceMs: clampNumber(
        client.debounceMs,
        DEFAULT_MARGIN_CLIENT_TUNING.debounceMs,
        500,
        15000,
      ),
      minParagraphLength: clampNumber(
        client.minParagraphLength,
        DEFAULT_MARGIN_CLIENT_TUNING.minParagraphLength,
        10,
        500,
      ),
      minParagraphWords: clampNumber(
        client.minParagraphWords,
        DEFAULT_MARGIN_CLIENT_TUNING.minParagraphWords,
        1,
        60,
      ),
      minQueryGapMs: clampNumber(
        client.minQueryGapMs,
        DEFAULT_MARGIN_CLIENT_TUNING.minQueryGapMs,
        0,
        60000,
      ),
      annotationCooldownMs: clampNumber(
        client.annotationCooldownMs,
        DEFAULT_MARGIN_CLIENT_TUNING.annotationCooldownMs,
        0,
        180000,
      ),
      maxAnnotationsPerEntry: clampNumber(
        client.maxAnnotationsPerEntry,
        DEFAULT_MARGIN_CLIENT_TUNING.maxAnnotationsPerEntry,
        1,
        30,
      ),
      minParagraphGap: clampNumber(
        client.minParagraphGap,
        DEFAULT_MARGIN_CLIENT_TUNING.minParagraphGap,
        0,
        20,
      ),
    },
    server: {
      minParagraphWords: clampNumber(
        server.minParagraphWords,
        DEFAULT_MARGIN_SERVER_TUNING.minParagraphWords,
        1,
        40,
      ),
      minActivationScore: clampNumber(
        server.minActivationScore,
        DEFAULT_MARGIN_SERVER_TUNING.minActivationScore,
        0.01,
        1,
      ),
      minTopActivation: clampNumber(
        server.minTopActivation,
        DEFAULT_MARGIN_SERVER_TUNING.minTopActivation,
        0.01,
        1,
      ),
      minTopGap: clampNumber(
        server.minTopGap,
        DEFAULT_MARGIN_SERVER_TUNING.minTopGap,
        0,
        0.5,
      ),
      strongTopOverride: clampNumber(
        server.strongTopOverride,
        DEFAULT_MARGIN_SERVER_TUNING.strongTopOverride,
        0.01,
        1,
      ),
      minModelConfidence: clampNumber(
        server.minModelConfidence,
        DEFAULT_MARGIN_SERVER_TUNING.minModelConfidence,
        0.01,
        1,
      ),
      maxMemoriesContext: clampNumber(
        server.maxMemoriesContext,
        DEFAULT_MARGIN_SERVER_TUNING.maxMemoriesContext,
        1,
        12,
      ),
      maxImplicationsContext: clampNumber(
        server.maxImplicationsContext,
        DEFAULT_MARGIN_SERVER_TUNING.maxImplicationsContext,
        0,
        8,
      ),
    },
    promptAddendum: cleanText(root.promptAddendum, 12000),
    promptOverride: cleanText(root.promptOverride, 24000),
  };
}
