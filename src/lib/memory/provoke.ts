/**
 * Dialogue Partner — Phase 8.
 * Extracts assertions from recent journal entries, finds counter-evidence
 * in the memory graph, and generates provocations using Opus.
 *
 * Three stages:
 *   A. Extract assertions from recent insights + memories
 *   B. Find counter-evidence via retrieval + abstract search
 *   C. Generate provocations with Opus
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  memories,
  journalInsights,
  memoryImplications,
  provocations,
} from "@/db/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { retrieveMemories } from "./retrieve";
import { embedSingle } from "./embed";

// ── Types ──────────────────────────────────────────────────────────────

interface Assertion {
  content: string; // The belief, decision, or self-assessment
  source: "journal" | "insight";
  sourceId: string;
}

interface CounterEvidence {
  assertion: Assertion;
  memories: Array<{ id: string; content: string }>;
  implications: Array<{ id: string; content: string }>;
}

interface GeneratedProvocation {
  triggerContent: string;
  triggerSource: string;
  provocation: string;
  supportingMemoryIds: string[];
  supportingMemoryContents: string[];
}

// ── Stage A: Extract assertions ────────────────────────────────────────

async function extractAssertions(
  userId: string,
  lookbackDays = 3
): Promise<Assertion[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Get recent insights (personal reflections, recurring themes)
  const recentInsights = await db
    .select({
      id: journalInsights.id,
      content: journalInsights.content,
      category: journalInsights.category,
    })
    .from(journalInsights)
    .where(
      and(
        eq(journalInsights.userId, userId),
        gte(journalInsights.entryDate, cutoffStr),
        sql`${journalInsights.category} IN ('personal_reflection', 'recurring_theme')`
      )
    )
    .limit(15);

  // Get recent memories (last 3 days)
  const recentMemories = await db
    .select({
      id: memories.id,
      content: memories.content,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        gte(memories.sourceDate, cutoffStr)
      )
    )
    .limit(20);

  if (recentInsights.length === 0 && recentMemories.length === 0) {
    return [];
  }

  // Use Haiku to identify assertions
  const client = new Anthropic({ timeout: 15_000 });

  const insightsStr = recentInsights
    .map((i) => `[insight:${i.id}] ${i.content}`)
    .join("\n");
  const memoriesStr = recentMemories
    .map((m) => `[memory:${m.id}] ${m.content}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Analyze these recent journal insights and memories from a personal journal. Identify 1-5 assertions — beliefs, decisions, self-assessments, or claims the writer is making about themselves, their relationships, or their life.

Focus on statements that could be challenged or complicated by other evidence. Skip trivial facts.

Recent insights:
${insightsStr || "(none)"}

Recent memories:
${memoriesStr || "(none)"}

Return ONLY valid JSON (no markdown):
{
  "assertions": [
    {
      "content": "The assertion, stated clearly and concisely",
      "sourceType": "journal" | "insight",
      "sourceId": "the id from the source"
    }
  ]
}

Examples of good assertions to extract:
- "I've been more present lately" (self-assessment — is this actually true?)
- "Sarah and I are in a great place" (relationship claim — any counter-evidence?)
- "I decided to prioritize work over social life this month" (decision — what are the consequences?)
- "I always follow through on my commitments" (belief — do the memories support this?)

Extract 1-5 assertions. If nothing is assertable, return an empty array.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      assertions: Array<{
        content: string;
        sourceType: "journal" | "insight";
        sourceId: string;
      }>;
    };

    return (parsed.assertions || [])
      .filter((a) => a.content && a.content.length > 10)
      .map((a) => ({
        content: a.content,
        source: a.sourceType,
        sourceId: a.sourceId,
      }));
  } catch {
    console.error("[provoke] Failed to parse assertions:", text.slice(0, 200));
    return [];
  }
}

// ── Stage B: Find counter-evidence ─────────────────────────────────────

async function findCounterEvidence(
  userId: string,
  assertions: Assertion[]
): Promise<CounterEvidence[]> {
  const results: CounterEvidence[] = [];

  for (const assertion of assertions) {
    const counterMemories: Array<{ id: string; content: string }> = [];
    const counterImplications: Array<{ id: string; content: string }> = [];

    // 1. Retrieve related memories via spreading activation
    try {
      const retrieval = await retrieveMemories(userId, assertion.content, {
        maxMemories: 10,
        maxHops: 1,
        skipHebbian: true,
        diversify: true,
      });

      // Keep memories that could serve as counter-evidence
      // (we'll let the LLM decide what's actually contradicting)
      for (const mem of retrieval.memories) {
        counterMemories.push({ id: mem.id, content: mem.content });
      }

      // Collect implications that might complicate the assertion
      for (const impl of retrieval.implications) {
        counterImplications.push({ id: impl.id, content: impl.content });
      }
    } catch (error) {
      console.error(
        `[provoke] Memory retrieval failed for assertion:`,
        error
      );
    }

    // 2. Also search abstract embeddings for structurally similar situations
    try {
      const assertionEmbedding = await embedSingle(assertion.content);

      const abstractMatches = await db.execute(sql`
        SELECT id, content
        FROM memories
        WHERE user_id = ${userId}
          AND abstract_embedding IS NOT NULL
          AND 1 - (abstract_embedding <=> ${sql.raw(`'[${assertionEmbedding.join(",")}]'`)}::vector) > 0.45
        ORDER BY 1 - (abstract_embedding <=> ${sql.raw(`'[${assertionEmbedding.join(",")}]'`)}::vector) DESC
        LIMIT 5
      `);

      for (const row of abstractMatches.rows as Array<{
        id: string;
        content: string;
      }>) {
        if (!counterMemories.some((m) => m.id === row.id)) {
          counterMemories.push({ id: row.id, content: row.content });
        }
      }
    } catch (error) {
      console.error(`[provoke] Abstract search failed:`, error);
    }

    // 3. Search implication embeddings for contradicting/complicating implications
    try {
      const assertionEmbedding = await embedSingle(assertion.content);

      const implMatches = await db.execute(sql`
        SELECT id, content, implication_type
        FROM memory_implications
        WHERE user_id = ${userId}
          AND embedding IS NOT NULL
          AND implication_type IN ('behavioral', 'meta_cognitive', 'retrograde', 'counterfactual', 'contradiction')
          AND 1 - (embedding <=> ${sql.raw(`'[${assertionEmbedding.join(",")}]'`)}::vector) > 0.4
        ORDER BY 1 - (embedding <=> ${sql.raw(`'[${assertionEmbedding.join(",")}]'`)}::vector) DESC
        LIMIT 3
      `);

      for (const row of implMatches.rows as Array<{
        id: string;
        content: string;
      }>) {
        if (!counterImplications.some((i) => i.id === row.id)) {
          counterImplications.push({ id: row.id, content: row.content });
        }
      }
    } catch (error) {
      console.error(`[provoke] Implication search failed:`, error);
    }

    // Only keep assertions with enough evidence to work with
    if (counterMemories.length >= 2 || counterImplications.length >= 1) {
      results.push({
        assertion,
        memories: counterMemories.slice(0, 8),
        implications: counterImplications.slice(0, 4),
      });
    }
  }

  return results;
}

// ── Stage C: Generate provocations (Opus) ──────────────────────────────

async function generateProvocations(
  counterEvidence: CounterEvidence[],
  max = 2
): Promise<GeneratedProvocation[]> {
  if (counterEvidence.length === 0) return [];

  const client = new Anthropic({ timeout: 30_000 });

  // Build context for the LLM
  const evidenceBlocks = counterEvidence
    .slice(0, max + 1) // Give it slightly more than max to pick the best
    .map((ce, i) => {
      const memoriesStr = ce.memories
        .map((m) => `  - ${m.content}`)
        .join("\n");
      const implStr = ce.implications
        .map((im) => `  - ${im.content}`)
        .join("\n");

      return `ASSERTION ${i + 1}: "${ce.assertion.content}"
Related memories:
${memoriesStr || "  (none)"}
Related implications:
${implStr || "  (none)"}`;
    })
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a dialogue partner for someone named Dhruv who journals daily. Your job is to push back on his recent assertions using evidence from his OWN memory graph — his own words, patterns, and history.

You are NOT a therapist. You are a direct, warm, slightly confrontational friend who says "wait, but didn't you just..." You notice things he doesn't.

For each assertion below, you have access to related memories and implications from Dhruv's journal. Your job:
1. Find the tension, contradiction, or complication in the evidence
2. Write a provocation that names the assertion, presents the specific counter-evidence, and poses an uncomfortable question
3. Only write a provocation if the counter-evidence genuinely challenges the assertion. If it doesn't, skip it.

${evidenceBlocks}

TONE RULES:
- Direct and specific. Name names, reference dates, cite what he actually said.
- Warm but confrontational — like a friend who cares enough to push back.
- 2-4 sentences max per provocation. No padding, no hedging, no therapy-speak.
- The question at the end should be genuinely uncomfortable but not cruel.
- Never start with "It's interesting that..." or "Have you considered..." — just say the thing.

Return ONLY valid JSON (no markdown):
{
  "provocations": [
    {
      "assertionIndex": 0,
      "provocation": "The provocation text — direct, warm, confrontational",
      "usedMemoryIds": ["ids of the memories cited as evidence"],
      "usedMemoryContents": ["the content of those memories, for display"]
    }
  ]
}

Generate at most ${max} provocations. Only include ones where the counter-evidence is genuinely compelling.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      provocations: Array<{
        assertionIndex: number;
        provocation: string;
        usedMemoryIds: string[];
        usedMemoryContents: string[];
      }>;
    };

    const validParsed = (parsed.provocations || []).filter(
      (p) => p.provocation && p.provocation.length > 20
    );

    const result: GeneratedProvocation[] = [];
    for (const p of validParsed) {
      const ce = counterEvidence[p.assertionIndex];
      if (!ce) continue;
      result.push({
        triggerContent: ce.assertion.content,
        triggerSource: ce.assertion.source,
        provocation: p.provocation,
        supportingMemoryIds: p.usedMemoryIds || [],
        supportingMemoryContents: p.usedMemoryContents || [],
      });
    }
    return result;
  } catch {
    console.error(
      "[provoke] Failed to parse provocations:",
      text.slice(0, 300)
    );
    return [];
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────

export async function generateProvocationsForUser(
  userId: string
): Promise<{ generated: number; errors: string[] }> {
  const errors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Check if we already generated provocations today
  const existing = await db
    .select({ id: provocations.id })
    .from(provocations)
    .where(
      and(eq(provocations.userId, userId), eq(provocations.date, today))
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(`[provoke] Already generated provocations for ${today}`);
    return { generated: 0, errors: [] };
  }

  // Stage A: Extract assertions
  let assertions: Assertion[] = [];
  try {
    assertions = await extractAssertions(userId);
    console.log(`[provoke] Extracted ${assertions.length} assertions`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Assertion extraction failed: ${msg}`);
    console.error("[provoke] Assertion extraction failed:", error);
    return { generated: 0, errors };
  }

  if (assertions.length === 0) {
    console.log("[provoke] No assertions found — skipping");
    return { generated: 0, errors: [] };
  }

  // Stage B: Find counter-evidence
  let evidence: CounterEvidence[] = [];
  try {
    evidence = await findCounterEvidence(userId, assertions);
    console.log(
      `[provoke] Found counter-evidence for ${evidence.length} assertions`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Counter-evidence search failed: ${msg}`);
    console.error("[provoke] Counter-evidence search failed:", error);
    return { generated: 0, errors };
  }

  if (evidence.length === 0) {
    console.log("[provoke] No sufficient counter-evidence found — skipping");
    return { generated: 0, errors: [] };
  }

  // Stage C: Generate provocations
  let generated: GeneratedProvocation[] = [];
  try {
    generated = await generateProvocations(evidence, 2);
    console.log(`[provoke] Generated ${generated.length} provocations`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Provocation generation failed: ${msg}`);
    console.error("[provoke] Provocation generation failed:", error);
    return { generated: 0, errors };
  }

  // Store provocations
  let stored = 0;
  for (const prov of generated) {
    try {
      await db
        .insert(provocations)
        .values({
          userId,
          date: today,
          triggerContent: prov.triggerContent,
          triggerSource: prov.triggerSource,
          provocation: prov.provocation,
          supportingMemoryIds: JSON.stringify(prov.supportingMemoryIds),
          supportingMemoryContents: JSON.stringify(
            prov.supportingMemoryContents
          ),
        })
        .onConflictDoNothing();

      stored++;
    } catch (error) {
      console.error("[provoke] Failed to store provocation:", error);
    }
  }

  return { generated: stored, errors };
}
