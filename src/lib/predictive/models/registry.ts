import { nnTemporalPlaceholderModel } from "./nnTemporal";
import { seqLinearModel } from "./seqLinear";
import { seqMarkovModel } from "./seqMarkov";
import type { PredictiveModelAdapter } from "./types";

const FALLBACK_MODEL_KEY = "seq_linear_v1";
const registry = new Map<string, PredictiveModelAdapter>();
let initialized = false;

export function registerModel(adapter: PredictiveModelAdapter): void {
  const key = adapter.modelKey();
  if (registry.has(key)) {
    throw new Error(`Predictive model adapter already registered for key \"${key}\".`);
  }
  registry.set(key, adapter);
}

export function listModels(): string[] {
  return Array.from(registry.keys()).sort((a, b) => a.localeCompare(b));
}

export function getModel(modelKey: string): PredictiveModelAdapter {
  const adapter = registry.get(modelKey);
  if (!adapter) {
    throw new Error(
      `Unknown predictive model key \"${modelKey}\". Available models: ${listModels().join(", ") || "(none)"}.`
    );
  }
  return adapter;
}

export function hasModel(modelKey: string): boolean {
  return registry.has(modelKey);
}

function initializeRegistryOnce() {
  if (initialized) return;
  initialized = true;

  registerModel(seqLinearModel);
  registerModel(seqMarkovModel);

  if (process.env.PREDICTIVE_ENABLE_NN_TEMPORAL === "1") {
    registerModel(nnTemporalPlaceholderModel);
  }

  const configured = (process.env.PREDICTIVE_MODEL_KEY || FALLBACK_MODEL_KEY).trim() || FALLBACK_MODEL_KEY;
  if (!hasModel(configured)) {
    throw new Error(
      `PREDICTIVE_MODEL_KEY is set to \"${configured}\" but no matching adapter is registered. ` +
        `Available models: ${listModels().join(", ") || "(none)"}.`
    );
  }
}

initializeRegistryOnce();

export const DEFAULT_PREDICTIVE_MODEL_KEY = FALLBACK_MODEL_KEY;
