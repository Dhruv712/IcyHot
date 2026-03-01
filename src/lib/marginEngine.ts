import {
  SPARK_TYPE_TARGET_MIX,
  type SparkNudge,
  type SparkNudgeType,
} from "@/lib/marginSpark";
import type { MarginTuningSettings } from "@/lib/marginTuning";

export interface CandidateDraft {
  type: SparkNudgeType;
  hook: string;
  whyNow: string;
  actionPrompt: string;
  evidenceMemoryDate?: string;
  evidenceMemorySnippet?: string;
  evidenceMemoryId?: string;
  modelConfidence: number;
  retrievalStrengthNormalized: number;
}

export interface JudgedCandidate extends CandidateDraft {
  tensionScore: number;
  actionabilityScore: number;
  noveltyScore: number;
  specificityScore: number;
  overallUtility: number;
  personalizationWeight: number;
  rankScore: number;
}

export interface GateResult {
  accepted: JudgedCandidate[];
  rejectionCounts: Record<string, number>;
}

export interface PersonalizationContext {
  typeWeights: Record<SparkNudgeType, number>;
  reasonPenalties: Record<string, number>;
}

export interface HistoricalNudge {
  type: SparkNudgeType;
  evidenceMemoryId: string | null;
  hook: string;
}

const HOOK_MAX_WORDS = 14;
const WHY_NOW_MAX_WORDS = 12;
const ACTION_PROMPT_MAX_WORDS = 9;
const EVIDENCE_MAX_WORDS = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseEmbeddedJson<T>(text: string): T | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

function trimToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}.`;
}

function normalizeSentence(text: string, fallback: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean || fallback;
}

export function normalizeCandidate(
  raw: Partial<CandidateDraft>,
  retrievalStrengthNormalized: number,
): CandidateDraft | null {
  if (
    raw.type !== "tension" &&
    raw.type !== "callback" &&
    raw.type !== "eyebrow_raise"
  ) {
    return null;
  }

  const hook = normalizeSentence(raw.hook ?? "", "");
  const whyNow = normalizeSentence(raw.whyNow ?? "", "");
  const actionPrompt = normalizeSentence(raw.actionPrompt ?? "", "");
  if (!hook || !whyNow || !actionPrompt) return null;

  return {
    type: raw.type,
    hook: trimToWords(hook, HOOK_MAX_WORDS),
    whyNow: trimToWords(whyNow, WHY_NOW_MAX_WORDS),
    actionPrompt: trimToWords(actionPrompt, ACTION_PROMPT_MAX_WORDS),
    evidenceMemoryDate: raw.evidenceMemoryDate,
    evidenceMemorySnippet: raw.evidenceMemorySnippet
      ? trimToWords(raw.evidenceMemorySnippet, EVIDENCE_MAX_WORDS)
      : raw.evidenceMemorySnippet,
    evidenceMemoryId: raw.evidenceMemoryId,
    modelConfidence: clamp(
      typeof raw.modelConfidence === "number" ? raw.modelConfidence : 0,
      0,
      1,
    ),
    retrievalStrengthNormalized: clamp(retrievalStrengthNormalized, 0, 1),
  };
}

export function normalizeJudgeScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return clamp(value, 0, 5);
}

function calculateRankScore(candidate: JudgedCandidate): number {
  return (
    0.55 * candidate.overallUtility +
    0.2 * candidate.retrievalStrengthNormalized * 5 +
    0.15 * candidate.noveltyScore +
    0.1 * candidate.personalizationWeight
  );
}

function countByType(nudges: HistoricalNudge[]): Record<SparkNudgeType, number> {
  const out: Record<SparkNudgeType, number> = {
    tension: 0,
    callback: 0,
    eyebrow_raise: 0,
  };
  for (const nudge of nudges) out[nudge.type] += 1;
  return out;
}

function mixPriority(
  type: SparkNudgeType,
  typeCounts: Record<SparkNudgeType, number>,
): number {
  const total = typeCounts.tension + typeCounts.callback + typeCounts.eyebrow_raise;
  const expected = SPARK_TYPE_TARGET_MIX[type] * Math.max(total, 1);
  return expected - typeCounts[type];
}

export function applyGateRankAndDiversify(
  candidates: JudgedCandidate[],
  tuning: MarginTuningSettings,
  history: HistoricalNudge[],
): GateResult {
  const rejectionCounts: Record<string, number> = {};

  const gated = candidates.filter((candidate) => {
    const reject = (reason: string) => {
      rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
      return false;
    };

    if (!candidate.evidenceMemoryDate || !candidate.evidenceMemorySnippet) {
      return reject("missing_evidence_anchor");
    }
    if (candidate.modelConfidence < tuning.server.minModelConfidence) {
      return reject("model_confidence");
    }
    if (candidate.overallUtility < tuning.server.minOverallUtility) {
      return reject("overall_utility");
    }
    if (candidate.specificityScore < tuning.server.minSpecificityScore) {
      return reject("specificity");
    }
    if (candidate.actionabilityScore < tuning.server.minActionabilityScore) {
      return reject("actionability");
    }

    return true;
  });

  if (gated.length === 0) return { accepted: [], rejectionCounts };

  const recent = history.slice(0, 3);
  const recentEvidenceIds = new Set(
    recent.map((h) => h.evidenceMemoryId).filter((x): x is string => Boolean(x)),
  );
  const recentHookPrefixes = new Set(
    recent.map((h) => h.hook.toLowerCase().split(" ").slice(0, 4).join(" ")),
  );

  const typeCounts = countByType(history);
  const scored = gated.map((candidate) => {
    const repeatedMemory =
      candidate.evidenceMemoryId && recentEvidenceIds.has(candidate.evidenceMemoryId);
    const hookPrefix = candidate.hook.toLowerCase().split(" ").slice(0, 4).join(" ");
    const repeatedHook = recentHookPrefixes.has(hookPrefix);
    const repetitionPenalty = repeatedMemory || repeatedHook ? 0.45 : 0;
    const mixBoost = mixPriority(candidate.type, typeCounts) * 0.2;

    const withScore: JudgedCandidate = {
      ...candidate,
      rankScore: calculateRankScore(candidate) + mixBoost - repetitionPenalty,
    };
    return withScore;
  });

  scored.sort((a, b) => b.rankScore - a.rankScore);

  const accepted: JudgedCandidate[] = [];
  const pickedTypes = new Set<SparkNudgeType>();
  for (const candidate of scored) {
    if (pickedTypes.has(candidate.type)) continue;
    accepted.push(candidate);
    pickedTypes.add(candidate.type);
    if (accepted.length >= 3) break;
  }

  // If all top items were from the same type and we still have room, fill remaining by score.
  if (accepted.length < 3) {
    for (const candidate of scored) {
      if (accepted.includes(candidate)) continue;
      accepted.push(candidate);
      if (accepted.length >= 3) break;
    }
  }

  accepted.sort((a, b) => b.rankScore - a.rankScore);

  return { accepted, rejectionCounts };
}

export function buildSessionTypeDistribution(
  nudges: Pick<SparkNudge, "type">[],
): Record<SparkNudgeType, number> {
  const counts: Record<SparkNudgeType, number> = {
    tension: 0,
    callback: 0,
    eyebrow_raise: 0,
  };
  for (const n of nudges) counts[n.type] += 1;
  return counts;
}

export function normalizeScoreFromTop(topScore: number): number {
  return clamp(topScore / 2, 0, 1);
}
