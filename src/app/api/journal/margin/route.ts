import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalNudgeFeedback, journalNudges } from "@/db/schema";
import {
  applyGateRankAndDiversify,
  buildSessionTypeDistribution,
  normalizeCandidate,
  normalizeScoreFromTop,
  parseEmbeddedJson,
  type CandidateDraft,
  type HistoricalNudge,
  type JudgedCandidate,
  type PersonalizationContext,
} from "@/lib/marginEngine";
import {
  coerceMarginTuning,
  DEFAULT_MARGIN_TUNING,
} from "@/lib/marginTuning";
import {
  SPARK_TYPE_TARGET_MIX,
  type MarginTrace,
  type SparkNudge,
  type SparkNudgeType,
} from "@/lib/marginSpark";
import { retrieveMemories } from "@/lib/memory/retrieve";

export const maxDuration = 15;

interface MarginAnnotationCompatibility {
  id: string;
  type: "ghost_question" | "tension";
  text: string;
  paragraphIndex: number;
  memoryDate?: string;
  memorySnippet?: string;
}

interface CandidateGenerationJson {
  candidates: Array<{
    type: SparkNudgeType;
    hook: string;
    whyNow: string;
    actionPrompt: string;
    evidenceMemoryDate?: string;
    evidenceMemorySnippet?: string;
    evidenceMemoryId?: string;
    modelConfidence?: number;
  }>;
}

interface UtilityJudgeJson {
  judgments: Array<{
    index: number;
    tensionScore: number;
    actionabilityScore: number;
    noveltyScore: number;
    specificityScore: number;
    overallUtility: number;
    failureReason?: string;
  }>;
}

type LlmFailureMode = NonNullable<MarginTrace["llm"]>["failureMode"];

type ParseFailureMode =
  | "accepted"
  | "model_empty"
  | "no_json"
  | "json_parse_error"
  | "filtered_text"
  | "filtered_type";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function hashParagraph(text: string): string {
  return createHash("md5").update(text).digest("hex").slice(0, 16);
}

function annotationFingerprint(
  type: string,
  text: string,
  memoryDate?: string,
  memorySnippet?: string,
): string {
  const payload = [
    type,
    normalizeWhitespace(text).toLowerCase(),
    memoryDate ?? "",
    normalizeWhitespace(memorySnippet ?? "").toLowerCase(),
  ].join("|");
  return createHash("md5").update(payload).digest("hex").slice(0, 16);
}

function readTextResponse(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

function safeText(value: unknown, maxLen = 260): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function buildMarginGenerationPrompt(
  paragraph: string,
  fullEntry: string,
  entryDate: string,
  memoriesContext: string,
  implicationsContext: string,
  promptAddendum: string,
  promptOverride: string,
): string {
  const entryTruncated =
    fullEntry.length > 1800 ? `${fullEntry.slice(0, 1800)}...` : fullEntry;

  if (promptOverride.trim()) {
    return promptOverride
      .replaceAll("{{entryDate}}", entryDate)
      .replaceAll("{{entry}}", entryTruncated)
      .replaceAll("{{paragraph}}", paragraph)
      .replaceAll("{{memories}}", memoriesContext || "(none)")
      .replaceAll("{{implications}}", implicationsContext || "(none)");
  }

  const addendum = promptAddendum.trim()
    ? `\nEXTRA DIRECTIVE FROM USER:\n${promptAddendum.trim()}\n`
    : "";

  return `You are generating high-utility Spark Cards for a personal journal margin. Generate 0-3 candidates (one per type when possible).

Today: ${entryDate}

Entry so far:
${entryTruncated || "(empty)"}

Paragraph just written:
"${paragraph}"

Retrieved memories (with IDs):
${memoriesContext || "(none)"}

Retrieved implications:
${implicationsContext || "(none)"}

Nudge taxonomy:
- tension: concrete contradiction or unresolved friction.
- callback: high-affinity memory worth revisiting right now.
- eyebrow_raise: subtle anomaly or drift signal to monitor.

Quality bar:
- Concrete anchors (who/when/what) only.
- No generic filler or therapy-speak.
- No broad, obvious observations.
- Hook must be one sentence, max 22 words.
- whyNow should explain why this matters now.
- actionPrompt should be one concrete next move.
- Evidence must map to a specific retrieved memory (date+snippet). Include evidenceMemoryId when possible.

${addendum}

Return JSON only in this shape:
{"candidates":[{"type":"tension"|"callback"|"eyebrow_raise","hook":"...","whyNow":"...","actionPrompt":"...","evidenceMemoryDate":"YYYY-MM-DD","evidenceMemorySnippet":"...","evidenceMemoryId":"...","modelConfidence":0.0}]}

If nothing is strong enough: {"candidates":[]}`;
}

function buildUtilityJudgePrompt(
  paragraph: string,
  candidates: CandidateDraft[],
): string {
  const payload = candidates.map((c, idx) => ({
    index: idx,
    type: c.type,
    hook: c.hook,
    whyNow: c.whyNow,
    actionPrompt: c.actionPrompt,
    evidenceMemoryDate: c.evidenceMemoryDate,
    evidenceMemorySnippet: c.evidenceMemorySnippet,
    modelConfidence: c.modelConfidence,
  }));

  return `You are a strict utility judge for journal margin nudges.

Paragraph:
"${paragraph}"

Candidates JSON:
${JSON.stringify(payload)}

For each candidate, score 0..5:
- tensionScore
- actionabilityScore
- noveltyScore
- specificityScore
- overallUtility

Rules:
- 5 means clearly specific/useful/actionable.
- Penalize generic or obvious phrasing heavily.
- Penalize missing evidence anchors heavily.
- Keep scoring independent per candidate.

Return JSON only:
{"judgments":[{"index":0,"tensionScore":0,"actionabilityScore":0,"noveltyScore":0,"specificityScore":0,"overallUtility":0,"failureReason":"optional"}]}`;
}

function parseCandidateResponse(
  text: string,
  retrievalStrengthNormalized: number,
): {
  failureMode: ParseFailureMode;
  candidates: CandidateDraft[];
  rawCandidates: number;
} {
  const rawJsonMatch = text.match(/\{[\s\S]*\}/);
  if (!rawJsonMatch) {
    return { failureMode: "no_json", candidates: [], rawCandidates: 0 };
  }

  const parsed = parseEmbeddedJson<CandidateGenerationJson>(text);
  if (!parsed) {
    return { failureMode: "json_parse_error", candidates: [], rawCandidates: 0 };
  }

  const raw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  if (raw.length === 0) {
    return { failureMode: "model_empty", candidates: [], rawCandidates: 0 };
  }

  const textFiltered = raw.filter((c) => {
    const hook = safeText(c.hook, 220);
    const whyNow = safeText(c.whyNow, 300);
    const actionPrompt = safeText(c.actionPrompt, 300);
    return hook.length >= 12 && whyNow.length >= 10 && actionPrompt.length >= 10;
  });

  if (textFiltered.length === 0) {
    return {
      failureMode: "filtered_text",
      candidates: [],
      rawCandidates: raw.length,
    };
  }

  const normalized = textFiltered
    .map((c) =>
      normalizeCandidate(
        {
          ...c,
          hook: safeText(c.hook, 220),
          whyNow: safeText(c.whyNow, 300),
          actionPrompt: safeText(c.actionPrompt, 300),
          evidenceMemorySnippet: safeText(c.evidenceMemorySnippet, 180),
          evidenceMemoryDate: safeText(c.evidenceMemoryDate, 16),
          evidenceMemoryId: safeText(c.evidenceMemoryId, 64),
        },
        retrievalStrengthNormalized,
      ),
    )
    .filter((c): c is CandidateDraft => Boolean(c));

  if (normalized.length === 0) {
    return {
      failureMode: "filtered_type",
      candidates: [],
      rawCandidates: raw.length,
    };
  }

  const byType = new Map<SparkNudgeType, CandidateDraft>();
  for (const c of normalized) {
    if (!byType.has(c.type)) byType.set(c.type, c);
  }

  return {
    failureMode: "accepted",
    candidates: Array.from(byType.values()).slice(0, 3),
    rawCandidates: raw.length,
  };
}

function parseJudgeResponse(
  text: string,
  candidates: CandidateDraft[],
  personalization: PersonalizationContext,
): {
  failureMode: LlmFailureMode;
  judged: JudgedCandidate[];
  judgedCount: number;
} {
  const rawJsonMatch = text.match(/\{[\s\S]*\}/);
  if (!rawJsonMatch) {
    return { failureMode: "judge_parse_error", judged: [], judgedCount: 0 };
  }

  const parsed = parseEmbeddedJson<UtilityJudgeJson>(text);
  if (!parsed || !Array.isArray(parsed.judgments)) {
    return { failureMode: "judge_parse_error", judged: [], judgedCount: 0 };
  }

  if (parsed.judgments.length === 0) {
    return { failureMode: "judge_empty", judged: [], judgedCount: 0 };
  }

  const judged: JudgedCandidate[] = [];

  for (const judgment of parsed.judgments) {
    const candidate = candidates[judgment.index];
    if (!candidate) continue;

    const typeWeight = personalization.typeWeights[candidate.type] ?? 2.5;
    const reasonPenalty = judgment.failureReason
      ? personalization.reasonPenalties[judgment.failureReason] ?? 0
      : 0;

    judged.push({
      ...candidate,
      tensionScore: clampScore(judgment.tensionScore),
      actionabilityScore: clampScore(judgment.actionabilityScore),
      noveltyScore: clampScore(judgment.noveltyScore),
      specificityScore: clampScore(judgment.specificityScore),
      overallUtility: clampScore(judgment.overallUtility),
      personalizationWeight: clampScore(typeWeight - reasonPenalty),
      rankScore: 0,
    });
  }

  if (judged.length === 0) {
    return { failureMode: "judge_empty", judged: [], judgedCount: 0 };
  }

  return {
    failureMode: "accepted",
    judged,
    judgedCount: judged.length,
  };
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.min(5, Math.max(0, value));
}

async function loadHistory(userId: string, entryDate: string): Promise<{
  recent: HistoricalNudge[];
  todayDistribution: Record<SparkNudgeType, number>;
  sessionDistribution: Record<SparkNudgeType, number>;
}> {
  const rows = await db
    .select({
      type: journalNudges.type,
      evidenceMemoryId: journalNudges.evidenceMemoryId,
      hook: journalNudges.hook,
      entryDate: journalNudges.entryDate,
    })
    .from(journalNudges)
    .where(eq(journalNudges.userId, userId))
    .orderBy(desc(journalNudges.createdAt))
    .limit(40);

  const recent = rows.slice(0, 20).map((row) => ({
    type: row.type,
    evidenceMemoryId: row.evidenceMemoryId,
    hook: row.hook,
  }));

  const todayRows = rows.filter((row) => {
    const rowDate =
      typeof row.entryDate === "string"
        ? row.entryDate
        : new Date(row.entryDate).toISOString().slice(0, 10);
    return rowDate === entryDate;
  });
  const sessionRows = rows.slice(0, 12);

  return {
    recent,
    todayDistribution: buildSessionTypeDistribution(todayRows),
    sessionDistribution: buildSessionTypeDistribution(sessionRows),
  };
}

async function loadPersonalization(userId: string): Promise<PersonalizationContext> {
  const feedbackRows = await db
    .select({
      type: journalNudges.type,
      feedback: journalNudgeFeedback.feedback,
      reason: journalNudgeFeedback.reason,
    })
    .from(journalNudgeFeedback)
    .innerJoin(journalNudges, eq(journalNudgeFeedback.nudgeId, journalNudges.id))
    .where(eq(journalNudgeFeedback.userId, userId))
    .orderBy(desc(journalNudgeFeedback.createdAt))
    .limit(200);

  const typeWeights: Record<SparkNudgeType, number> = {
    tension: 2.7,
    callback: 2.5,
    eyebrow_raise: 2.3,
  };

  const reasonPenalties: Record<string, number> = {};

  for (const row of feedbackRows) {
    const delta = row.feedback === "up" ? 0.06 : -0.09;
    typeWeights[row.type] = Math.max(0, Math.min(5, typeWeights[row.type] + delta));
    if (row.feedback === "down" && row.reason) {
      reasonPenalties[row.reason] = Math.min(
        2,
        (reasonPenalties[row.reason] ?? 0) + 0.08,
      );
    }
  }

  return { typeWeights, reasonPenalties };
}

function mapToCompatibilityAnnotation(
  nudge: SparkNudge,
): MarginAnnotationCompatibility {
  return {
    id: `${annotationFingerprint(
      nudge.type,
      nudge.hook,
      nudge.evidenceMemoryDate,
      nudge.evidenceMemorySnippet,
    )}-${nudge.paragraphIndex}`,
    type: nudge.type === "tension" ? "tension" : "ghost_question",
    text: nudge.hook,
    paragraphIndex: nudge.paragraphIndex,
    memoryDate: nudge.evidenceMemoryDate,
    memorySnippet: nudge.evidenceMemorySnippet,
  };
}

export async function POST(request: NextRequest) {
  const totalStart = Date.now();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sparkMode = resolveSparkMode(session.user.id);

  const {
    paragraph,
    fullEntry,
    entryDate,
    paragraphIndex,
    tuning,
  }: {
    paragraph?: string;
    fullEntry?: string;
    entryDate?: string;
    paragraphIndex?: number;
    tuning?: unknown;
    clientSessionId?: string;
  } = await request.json();

  const resolvedTuning = coerceMarginTuning(tuning ?? DEFAULT_MARGIN_TUNING);
  const server = resolvedTuning.server;

  if (!paragraph || typeof paragraph !== "string" || paragraph.trim().length < 20) {
    const trace: MarginTrace = {
      reason: "Paragraph too short for margin analysis.",
      funnel: {
        generated: 0,
        judged: 0,
        accepted: 0,
        rejectionCounts: {},
        targetMix: SPARK_TYPE_TARGET_MIX,
        todayTypeDistribution: { tension: 0, callback: 0, eyebrow_raise: 0 },
        sessionTypeDistribution: { tension: 0, callback: 0, eyebrow_raise: 0 },
      },
      timingsMs: {
        retrieve: 0,
        generate: 0,
        judge: 0,
        total: Date.now() - totalStart,
      },
    };
    return NextResponse.json({
      nudges: [],
      annotations: [],
      paragraphHash: "",
      trace,
    });
  }

  const trimmedParagraph = paragraph.trim();
  const wordCount = trimmedParagraph.split(/\s+/).filter(Boolean).length;
  if (wordCount < server.minParagraphWords) {
    const trace: MarginTrace = {
      reason: `Skipped: paragraph has ${wordCount} words (< ${server.minParagraphWords}).`,
      funnel: {
        generated: 0,
        judged: 0,
        accepted: 0,
        rejectionCounts: {},
        targetMix: SPARK_TYPE_TARGET_MIX,
        todayTypeDistribution: { tension: 0, callback: 0, eyebrow_raise: 0 },
        sessionTypeDistribution: { tension: 0, callback: 0, eyebrow_raise: 0 },
      },
      timingsMs: {
        retrieve: 0,
        generate: 0,
        judge: 0,
        total: Date.now() - totalStart,
      },
    };
    return NextResponse.json({
      nudges: [],
      annotations: [],
      paragraphHash: "",
      trace,
    });
  }

  const resolvedEntryDate =
    typeof entryDate === "string" && entryDate.length >= 10
      ? entryDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  const paragraphHash = hashParagraph(trimmedParagraph);

  const zeroDistribution = {
    tension: 0,
    callback: 0,
    eyebrow_raise: 0,
  } satisfies Record<SparkNudgeType, number>;

  let retrieveMs = 0;
  let generateMs = 0;
  let judgeMs = 0;
  let rawCandidates = 0;
  let judgedCount = 0;
  let failureMode: LlmFailureMode = "model_empty";
  let rejectionCounts: Record<string, number> = {};

  try {
    const retrieveStart = Date.now();
    const retrieval = await retrieveMemories(session.user.id, trimmedParagraph, {
      maxMemories: 12,
      maxHops: 1,
      skipHebbian: true,
      diversify: true,
    });
    retrieveMs = Date.now() - retrieveStart;

    const strongMemories = retrieval.memories.filter(
      (m) => m.activationScore >= server.minActivationScore,
    );
    const topScore = retrieval.memories[0]?.activationScore ?? 0;
    const secondScore = retrieval.memories[1]?.activationScore ?? 0;
    const hasClearSignal =
      topScore >= server.strongTopOverride ||
      (topScore >= server.minTopActivation &&
        (topScore - secondScore >= server.minTopGap || strongMemories.length >= 2));

    const retrievalTrace: NonNullable<MarginTrace["retrieval"]> = {
      totalMemories: retrieval.memories.length,
      strongMemories: strongMemories.length,
      topScore: Number(topScore.toFixed(3)),
      secondScore: Number(secondScore.toFixed(3)),
      hasClearSignal,
      implications: retrieval.implications.length,
      topSamples: retrieval.memories.slice(0, 4).map((m) => ({
        score: Number(m.activationScore.toFixed(3)),
        hop: m.hop,
        snippet: m.content.slice(0, 60),
      })),
    };

    const { recent, todayDistribution, sessionDistribution } = await loadHistory(
      session.user.id,
      resolvedEntryDate,
    );

    const baseTrace: MarginTrace = {
      reason: "No nudge this pass.",
      retrieval: retrievalTrace,
      llm: {
        rawCandidates: 0,
        judgedCandidates: 0,
        accepted: 0,
        failureMode: "model_empty",
        minModelConfidence: server.minModelConfidence,
      },
      funnel: {
        generated: 0,
        judged: 0,
        accepted: 0,
        rejectionCounts: {},
        targetMix: SPARK_TYPE_TARGET_MIX,
        todayTypeDistribution: todayDistribution,
        sessionTypeDistribution: sessionDistribution,
      },
      timingsMs: {
        retrieve: retrieveMs,
        generate: 0,
        judge: 0,
        total: Date.now() - totalStart,
      },
    };

    if (
      (strongMemories.length === 0 && retrieval.implications.length === 0) ||
      !hasClearSignal
    ) {
      baseTrace.reason =
        strongMemories.length === 0 && retrieval.implications.length === 0
          ? "No sufficiently strong memories or implications found."
          : "Signal not clear enough yet (top match not distinct).";
      baseTrace.llm = undefined;
      baseTrace.timingsMs.total = Date.now() - totalStart;
      return NextResponse.json({
        nudges: [],
        annotations: [],
        paragraphHash,
        trace: baseTrace,
      });
    }

    const memoriesContext = strongMemories
      .slice(0, server.maxMemoriesContext)
      .map(
        (m) =>
          `- id:${m.id} date:${m.sourceDate} score:${m.activationScore.toFixed(3)}\n  text:${m.content}`,
      )
      .join("\n");

    const implicationsContext = retrieval.implications
      .slice(0, server.maxImplicationsContext)
      .map((i) => `- ${i.content}`)
      .join("\n");

    const client = new Anthropic({ timeout: 10_000 });

    const generateStart = Date.now();
    const generationResponse = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content: buildMarginGenerationPrompt(
            trimmedParagraph,
            fullEntry || "",
            resolvedEntryDate,
            memoriesContext,
            implicationsContext,
            resolvedTuning.promptAddendum,
            resolvedTuning.promptOverride,
          ),
        },
      ],
    });
    generateMs = Date.now() - generateStart;

    const generationText = readTextResponse(generationResponse);
    const parsedGeneration = parseCandidateResponse(
      generationText,
      normalizeScoreFromTop(topScore),
    );

    rawCandidates = parsedGeneration.rawCandidates;

    if (parsedGeneration.failureMode !== "accepted") {
      failureMode = parsedGeneration.failureMode;
      const trace: MarginTrace = {
        ...baseTrace,
        reason: explainFailureMode(failureMode),
        llm: {
          rawCandidates,
          judgedCandidates: 0,
          accepted: 0,
          failureMode,
          minModelConfidence: server.minModelConfidence,
        },
        funnel: {
          ...baseTrace.funnel!,
          generated: rawCandidates,
          judged: 0,
          accepted: 0,
          rejectionCounts: {},
        },
        timingsMs: {
          retrieve: retrieveMs,
          generate: generateMs,
          judge: 0,
          total: Date.now() - totalStart,
        },
      };

      return NextResponse.json({
        nudges: [],
        annotations: [],
        paragraphHash,
        trace,
      });
    }

    const personalization = await loadPersonalization(session.user.id);

    const judgeStart = Date.now();
    const judgeResponse = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: buildUtilityJudgePrompt(trimmedParagraph, parsedGeneration.candidates),
        },
      ],
    });
    judgeMs = Date.now() - judgeStart;

    const judgeText = readTextResponse(judgeResponse);
    const parsedJudge = parseJudgeResponse(
      judgeText,
      parsedGeneration.candidates,
      personalization,
    );
    judgedCount = parsedJudge.judgedCount;

    if (parsedJudge.failureMode !== "accepted") {
      failureMode = parsedJudge.failureMode;
      const trace: MarginTrace = {
        ...baseTrace,
        reason: explainFailureMode(failureMode),
        llm: {
          rawCandidates,
          judgedCandidates: judgedCount,
          accepted: 0,
          failureMode,
          minModelConfidence: server.minModelConfidence,
        },
        funnel: {
          ...baseTrace.funnel!,
          generated: parsedGeneration.candidates.length,
          judged: judgedCount,
          accepted: 0,
          rejectionCounts: {},
        },
        timingsMs: {
          retrieve: retrieveMs,
          generate: generateMs,
          judge: judgeMs,
          total: Date.now() - totalStart,
        },
      };
      return NextResponse.json({
        nudges: [],
        annotations: [],
        paragraphHash,
        trace,
      });
    }

    const gate = applyGateRankAndDiversify(
      parsedJudge.judged,
      resolvedTuning,
      recent,
    );
    rejectionCounts = gate.rejectionCounts;

    const topAccepted = gate.accepted.slice(0, 1); // one card per paragraph max

    if (topAccepted.length === 0) {
      failureMode = "gate_rejected";
      const trace: MarginTrace = {
        ...baseTrace,
        reason: "Model returned candidates but none passed utility gates.",
        llm: {
          rawCandidates,
          judgedCandidates: judgedCount,
          accepted: 0,
          failureMode,
          minModelConfidence: server.minModelConfidence,
        },
        funnel: {
          ...baseTrace.funnel!,
          generated: parsedGeneration.candidates.length,
          judged: judgedCount,
          accepted: 0,
          rejectionCounts,
        },
        timingsMs: {
          retrieve: retrieveMs,
          generate: generateMs,
          judge: judgeMs,
          total: Date.now() - totalStart,
        },
      };

      return NextResponse.json({
        nudges: [],
        annotations: [],
        paragraphHash,
        trace,
      });
    }

    const insertedNudges = await Promise.all(
      topAccepted.map(async (candidate) => {
        const inserted = await db
          .insert(journalNudges)
          .values({
            id: randomUUID(),
            userId: session.user.id,
            entryDate: resolvedEntryDate,
            paragraphHash,
            paragraphIndex: paragraphIndex ?? 0,
            type: candidate.type,
            hook: candidate.hook,
            evidenceMemoryId: candidate.evidenceMemoryId || null,
            evidenceMemoryDate: candidate.evidenceMemoryDate || null,
            retrievalTopScore: Number(topScore.toFixed(5)),
            retrievalSecondScore: Number(secondScore.toFixed(5)),
            utilityScore: Number(candidate.overallUtility.toFixed(4)),
            modelConfidence: Number(candidate.modelConfidence.toFixed(4)),
          })
          .onConflictDoUpdate({
            target: [
              journalNudges.userId,
              journalNudges.entryDate,
              journalNudges.paragraphHash,
              journalNudges.type,
            ],
            set: {
              paragraphIndex: paragraphIndex ?? 0,
              hook: candidate.hook,
              evidenceMemoryId: candidate.evidenceMemoryId || null,
              evidenceMemoryDate: candidate.evidenceMemoryDate || null,
              retrievalTopScore: Number(topScore.toFixed(5)),
              retrievalSecondScore: Number(secondScore.toFixed(5)),
              utilityScore: Number(candidate.overallUtility.toFixed(4)),
              modelConfidence: Number(candidate.modelConfidence.toFixed(4)),
              createdAt: new Date(),
            },
          })
          .returning({ id: journalNudges.id });

        const id = inserted[0]?.id ?? randomUUID();

        const nudge: SparkNudge = {
          id,
          type: candidate.type,
          hook: candidate.hook,
          whyNow: candidate.whyNow,
          actionPrompt: candidate.actionPrompt,
          paragraphIndex: paragraphIndex ?? 0,
          paragraphHash,
          evidenceMemoryId: candidate.evidenceMemoryId || undefined,
          evidenceMemoryDate: candidate.evidenceMemoryDate,
          evidenceMemorySnippet: candidate.evidenceMemorySnippet,
          scores: {
            overallUtility: Number(candidate.overallUtility.toFixed(3)),
            tensionScore: Number(candidate.tensionScore.toFixed(3)),
            actionabilityScore: Number(candidate.actionabilityScore.toFixed(3)),
            noveltyScore: Number(candidate.noveltyScore.toFixed(3)),
            specificityScore: Number(candidate.specificityScore.toFixed(3)),
            modelConfidence: Number(candidate.modelConfidence.toFixed(3)),
          },
        };

        return nudge;
      }),
    );

    const newSessionDistribution = {
      ...baseTrace.funnel!.sessionTypeDistribution,
      [insertedNudges[0].type]:
        (baseTrace.funnel!.sessionTypeDistribution[insertedNudges[0].type] ?? 0) + 1,
    } as Record<SparkNudgeType, number>;

    const trace: MarginTrace = {
      ...baseTrace,
      reason: "Spark nudge accepted.",
      llm: {
        rawCandidates,
        judgedCandidates: judgedCount,
        accepted: insertedNudges.length,
        failureMode: "accepted",
        minModelConfidence: server.minModelConfidence,
      },
      funnel: {
        ...baseTrace.funnel!,
        generated: parsedGeneration.candidates.length,
        judged: judgedCount,
        accepted: insertedNudges.length,
        rejectionCounts,
        sessionTypeDistribution: newSessionDistribution,
      },
      timingsMs: {
        retrieve: retrieveMs,
        generate: generateMs,
        judge: judgeMs,
        total: Date.now() - totalStart,
      },
    };

    const compatibility = insertedNudges.map(mapToCompatibilityAnnotation);
    const visibleNudges =
      sparkMode.sparkEnabled && !sparkMode.shadowMode ? insertedNudges : [];
    if (!sparkMode.sparkEnabled || sparkMode.shadowMode) {
      trace.reason = `${trace.reason} (spark cards ${sparkMode.shadowMode ? "shadow" : "disabled"} mode)`;
    }

    return NextResponse.json({
      nudges: visibleNudges,
      annotations: compatibility,
      paragraphHash,
      trace,
    });
  } catch (error) {
    console.error("[margin] Error:", error);
    const trace: MarginTrace = {
      reason: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      llm: {
        rawCandidates,
        judgedCandidates: judgedCount,
        accepted: 0,
        failureMode,
        minModelConfidence: server.minModelConfidence,
      },
      funnel: {
        generated: rawCandidates,
        judged: judgedCount,
        accepted: 0,
        rejectionCounts,
        targetMix: SPARK_TYPE_TARGET_MIX,
        todayTypeDistribution: zeroDistribution,
        sessionTypeDistribution: zeroDistribution,
      },
      timingsMs: {
        retrieve: retrieveMs,
        generate: generateMs,
        judge: judgeMs,
        total: Date.now() - totalStart,
      },
    };

    return NextResponse.json({
      nudges: [],
      annotations: [],
      paragraphHash,
      trace,
    });
  }
}

function explainFailureMode(mode: LlmFailureMode): string {
  const reasonByFailureMode: Record<LlmFailureMode, string> = {
    accepted: "Spark nudge accepted.",
    model_empty: "Model intentionally returned no candidates.",
    no_json: "Model response had no JSON block.",
    json_parse_error: "Model returned malformed JSON.",
    filtered_text: "Candidates failed text-format filters.",
    filtered_type: "Candidates had unsupported nudge types.",
    filtered_confidence: "Candidates were below confidence threshold.",
    judge_parse_error: "Judge pass response was malformed.",
    judge_empty: "Judge pass returned no usable scores.",
    gate_rejected: "Candidates did not meet utility gates.",
  };
  return reasonByFailureMode[mode];
}

function parseCsv(value: string | undefined): Set<string> {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

function resolveSparkMode(userId: string): {
  sparkEnabled: boolean;
  shadowMode: boolean;
} {
  const explicitUsers = parseCsv(process.env.SPARK_MARGIN_V1_USERS);
  const shadowUsers = parseCsv(process.env.SPARK_MARGIN_V1_SHADOW_USERS);
  const defaultEnabled = process.env.SPARK_MARGIN_V1_DEFAULT !== "0";

  const sparkEnabled =
    explicitUsers.size > 0 ? explicitUsers.has(userId) : defaultEnabled;
  const shadowMode = shadowUsers.has(userId);

  return { sparkEnabled, shadowMode };
}
