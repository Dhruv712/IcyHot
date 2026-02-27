export type SparkNudgeType = "tension" | "callback" | "eyebrow_raise";

export type MarginFeedback = "up" | "down";

export type MarginDownReason =
  | "too_vague"
  | "wrong_connection"
  | "already_obvious"
  | "bad_tone"
  | "not_now";

export interface SparkNudgeScores {
  overallUtility: number;
  tensionScore: number;
  actionabilityScore: number;
  noveltyScore: number;
  specificityScore: number;
  modelConfidence: number;
}

export interface SparkNudge {
  id: string;
  type: SparkNudgeType;
  hook: string;
  whyNow: string;
  actionPrompt: string;
  paragraphIndex: number;
  paragraphHash: string;
  evidenceMemoryId?: string;
  evidenceMemoryDate?: string;
  evidenceMemorySnippet?: string;
  scores: SparkNudgeScores;
}

export interface MarginTrace {
  reason: string;
  retrieval?: {
    totalMemories: number;
    strongMemories: number;
    topScore: number;
    secondScore: number;
    hasClearSignal: boolean;
    implications: number;
    topSamples: Array<{
      score: number;
      hop: number;
      snippet: string;
    }>;
  };
  llm?: {
    rawCandidates: number;
    judgedCandidates: number;
    accepted: number;
    failureMode:
      | "accepted"
      | "model_empty"
      | "no_json"
      | "json_parse_error"
      | "filtered_text"
      | "filtered_type"
      | "filtered_confidence"
      | "judge_parse_error"
      | "judge_empty"
      | "gate_rejected";
    minModelConfidence: number;
  };
  funnel?: {
    generated: number;
    judged: number;
    accepted: number;
    rejectionCounts: Record<string, number>;
    targetMix: Record<SparkNudgeType, number>;
    todayTypeDistribution: Record<SparkNudgeType, number>;
    sessionTypeDistribution: Record<SparkNudgeType, number>;
  };
  timingsMs: {
    retrieve: number;
    generate: number;
    judge: number;
    total: number;
  };
}

export const SPARK_TYPE_TARGET_MIX: Record<SparkNudgeType, number> = {
  tension: 0.6,
  callback: 0.25,
  eyebrow_raise: 0.15,
};

export const DOWNVOTE_REASONS: MarginDownReason[] = [
  "too_vague",
  "wrong_connection",
  "already_obvious",
  "bad_tone",
  "not_now",
];
