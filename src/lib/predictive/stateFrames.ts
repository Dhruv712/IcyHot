import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { journalDrafts, journalStateFrames, userPredictiveStatus } from "@/db/schema";

const TAXONOMY_VERSION = "core10_v1";

const LEXICON = {
  uncertainty: ["maybe", "not sure", "uncertain", "confused", "guess", "perhaps", "idk"],
  decision: ["decide", "decided", "choice", "commit", "plan", "will", "going to"],
  relationship: ["friend", "mom", "dad", "partner", "team", "colleague", "with"],
  action: ["did", "sent", "called", "started", "finished", "built", "wrote"],
  belief: ["believe", "value", "principle", "should", "must", "meaning"],
  stress: ["anxious", "stressed", "overwhelmed", "frustrated", "worried", "panic"],
  joy: ["happy", "grateful", "excited", "proud", "relieved", "energized"],
  sadness: ["sad", "down", "lonely", "tired", "drained", "upset"],
  novelty: ["new", "first", "surprising", "different", "unexpected", "shift"],
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function phraseCount(text: string, phrases: readonly string[]): number {
  const lower = text.toLowerCase();
  return phrases.reduce((count, phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = lower.match(new RegExp(`\\b${escaped}\\b`, "g"));
    return count + (matches?.length ?? 0);
  }, 0);
}

function ratio(count: number, totalWords: number): number {
  if (totalWords <= 0) return 0;
  return clamp(count / Math.max(20, totalWords), 0, 1);
}

export function buildCore10StateVector(content: string): number[] {
  const tokens = tokenize(content);
  const totalWords = tokens.length;

  const uncertainty = ratio(phraseCount(content, LEXICON.uncertainty), totalWords);
  const decision = ratio(phraseCount(content, LEXICON.decision), totalWords);
  const relationship = ratio(phraseCount(content, LEXICON.relationship), totalWords);
  const action = ratio(phraseCount(content, LEXICON.action), totalWords);
  const belief = ratio(phraseCount(content, LEXICON.belief), totalWords);
  const stress = ratio(phraseCount(content, LEXICON.stress), totalWords);
  const joy = ratio(phraseCount(content, LEXICON.joy), totalWords);
  const sadness = ratio(phraseCount(content, LEXICON.sadness), totalWords);
  const novelty = ratio(phraseCount(content, LEXICON.novelty), totalWords);
  const emotionalIntensity = clamp(stress + joy + sadness, 0, 1);

  return [
    Number(emotionalIntensity.toFixed(6)),
    Number(clamp(0.5 + joy - sadness, 0, 1).toFixed(6)),
    Number(decision.toFixed(6)),
    Number(relationship.toFixed(6)),
    Number(uncertainty.toFixed(6)),
    Number(belief.toFixed(6)),
    Number(action.toFixed(6)),
    Number(clamp(1 - stress, 0, 1).toFixed(6)),
    Number(stress.toFixed(6)),
    Number(novelty.toFixed(6)),
  ];
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isMissingPredictiveSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("journal_state_frames") ||
    message.includes("user_predictive_status") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

export async function syncStateFramesForUser(userId: string): Promise<{
  draftsSeen: number;
  framesUpserted: number;
  backfillComplete: boolean;
}> {
  try {
    const drafts = await db
      .select({
        id: journalDrafts.id,
        entryDate: journalDrafts.entryDate,
        content: journalDrafts.content,
      })
      .from(journalDrafts)
      .where(eq(journalDrafts.userId, userId));

    if (drafts.length === 0) {
      const [existingStatus] = await db
        .select()
        .from(userPredictiveStatus)
        .where(eq(userPredictiveStatus.userId, userId))
        .limit(1);

      await db
        .insert(userPredictiveStatus)
        .values({
          userId,
          framesCount: 0,
          backfillCompleteAt: existingStatus?.backfillCompleteAt ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPredictiveStatus.userId,
          set: {
            framesCount: 0,
            updatedAt: new Date(),
          },
        });

      return {
        draftsSeen: 0,
        framesUpserted: 0,
        backfillComplete: false,
      };
    }

    const existingFrames = await db
      .select({
        entryDate: journalStateFrames.entryDate,
        contentHash: journalStateFrames.contentHash,
      })
      .from(journalStateFrames)
      .where(eq(journalStateFrames.userId, userId));

    const existingByDate = new Map(
      existingFrames.map((frame) => [frame.entryDate, frame.contentHash])
    );

    let framesUpserted = 0;
    for (const draft of drafts) {
      const content = draft.content?.trim() ?? "";
      if (content.length < 10) continue;

      const contentHash = hashContent(content);
      const previousHash = existingByDate.get(draft.entryDate);
      if (previousHash === contentHash) continue;

      const vector = buildCore10StateVector(content);
      await db
        .insert(journalStateFrames)
        .values({
          userId,
          entryDate: draft.entryDate,
          entryId: draft.id,
          stateVector: vector,
          taxonomyVersion: TAXONOMY_VERSION,
          contentHash,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [journalStateFrames.userId, journalStateFrames.entryDate],
          set: {
            entryId: draft.id,
            stateVector: vector,
            taxonomyVersion: TAXONOMY_VERSION,
            contentHash,
            updatedAt: new Date(),
          },
        });

      framesUpserted += 1;
    }

    const [status] = await db
      .select()
      .from(userPredictiveStatus)
      .where(eq(userPredictiveStatus.userId, userId))
      .limit(1);

    const completeDate = status?.backfillCompleteAt ?? new Date();

    await db
      .insert(userPredictiveStatus)
      .values({
        userId,
        framesCount: drafts.length,
        backfillCompleteAt: completeDate,
        lastEntryProcessedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPredictiveStatus.userId,
        set: {
          framesCount: drafts.length,
          backfillCompleteAt: completeDate,
          lastEntryProcessedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    return {
      draftsSeen: drafts.length,
      framesUpserted,
      backfillComplete: true,
    };
  } catch (error) {
    if (isMissingPredictiveSchemaError(error)) {
      return {
        draftsSeen: 0,
        framesUpserted: 0,
        backfillComplete: false,
      };
    }

    throw error;
  }
}
