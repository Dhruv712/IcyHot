import { eq } from "drizzle-orm";
import { db } from "@/db";
import { predictiveGlobalConfig, predictiveModelOverrides } from "@/db/schema";
import { DEFAULT_PREDICTIVE_MODEL_KEY, getModel, hasModel, listModels } from "./models/registry";

export type PredictiveSelectionSource =
  | "user_override"
  | "global_override"
  | "env"
  | "fallback";

export type ResolvedPredictiveSelection = {
  modelKey: string;
  config: Record<string, unknown>;
  source: PredictiveSelectionSource;
};

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function isMissingPredictiveSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("predictive_model_overrides") ||
    message.includes("predictive_global_config") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

function normalizeModelKey(modelKey: string | null | undefined): string {
  const normalized = modelKey?.trim();
  if (!normalized) return DEFAULT_PREDICTIVE_MODEL_KEY;
  return normalized;
}

export function parseEnvPredictiveConfig(): Record<string, unknown> {
  const raw = process.env.PREDICTIVE_MODEL_CONFIG_JSON;
  if (!raw) return {};
  return parseJsonObject(raw);
}

export function getEnvPredictiveModelKey(): string {
  return normalizeModelKey(process.env.PREDICTIVE_MODEL_KEY);
}

export function ensurePredictiveModelExists(modelKey: string): void {
  if (!hasModel(modelKey)) {
    throw new Error(
      `Unknown predictive model key \"${modelKey}\". Available models: ${listModels().join(", ") || "(none)"}.`
    );
  }
}

export function validateModelConfig(modelKey: string, config: Record<string, unknown>): {
  ok: boolean;
  errors: string[];
} {
  const adapter = getModel(modelKey);
  const validation = adapter.validateConfig(config);
  return {
    ok: validation.ok,
    errors: validation.errors,
  };
}

export async function resolvePredictiveSelectionForUser(
  userId: string
): Promise<ResolvedPredictiveSelection> {
  const envModelKey = getEnvPredictiveModelKey();
  ensurePredictiveModelExists(envModelKey);
  const envConfig = parseEnvPredictiveConfig();

  try {
    const [userOverride] = await db
      .select({ modelKey: predictiveModelOverrides.modelKey, configJson: predictiveModelOverrides.configJson })
      .from(predictiveModelOverrides)
      .where(eq(predictiveModelOverrides.userId, userId))
      .limit(1);

    if (userOverride) {
      const userModelKey = normalizeModelKey(userOverride.modelKey);
      ensurePredictiveModelExists(userModelKey);
      return {
        modelKey: userModelKey,
        config: parseJsonObject(userOverride.configJson),
        source: "user_override",
      };
    }

    const [globalOverride] = await db
      .select({ modelKey: predictiveGlobalConfig.modelKey, configJson: predictiveGlobalConfig.configJson })
      .from(predictiveGlobalConfig)
      .where(eq(predictiveGlobalConfig.id, 1))
      .limit(1);

    if (globalOverride) {
      const globalModelKey = normalizeModelKey(globalOverride.modelKey);
      ensurePredictiveModelExists(globalModelKey);
      return {
        modelKey: globalModelKey,
        config: parseJsonObject(globalOverride.configJson),
        source: "global_override",
      };
    }
  } catch (error) {
    if (!isMissingPredictiveSchemaError(error)) {
      throw error;
    }
  }

  if (process.env.PREDICTIVE_MODEL_KEY) {
    return {
      modelKey: envModelKey,
      config: envConfig,
      source: "env",
    };
  }

  return {
    modelKey: DEFAULT_PREDICTIVE_MODEL_KEY,
    config: envConfig,
    source: "fallback",
  };
}

export async function upsertPredictiveGlobalSelection(input: {
  modelKey: string;
  config: Record<string, unknown>;
}) {
  ensurePredictiveModelExists(input.modelKey);

  await db
    .insert(predictiveGlobalConfig)
    .values({
      id: 1,
      modelKey: input.modelKey,
      configJson: input.config,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: predictiveGlobalConfig.id,
      set: {
        modelKey: input.modelKey,
        configJson: input.config,
        updatedAt: new Date(),
      },
    });
}

export async function upsertPredictiveUserSelection(input: {
  userId: string;
  modelKey: string;
  config: Record<string, unknown>;
}) {
  ensurePredictiveModelExists(input.modelKey);

  await db
    .insert(predictiveModelOverrides)
    .values({
      userId: input.userId,
      modelKey: input.modelKey,
      configJson: input.config,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: predictiveModelOverrides.userId,
      set: {
        modelKey: input.modelKey,
        configJson: input.config,
        updatedAt: new Date(),
      },
    });
}
