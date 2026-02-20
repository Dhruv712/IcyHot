/**
 * Memory consolidation — Phase 10 rewrite.
 *
 * Three-stage pipeline (inspired by provocations architecture):
 *   Stage 1: discoverConnections() — Sonnet — structural relationships between memory pairs
 *   Stage 2: synthesizeImplications() — Opus — one profound insight per cluster
 *   Stage 3: qualityGate() — Haiku — score each implication, discard < 4/5
 *
 * Anti-clustering pass runs the same 3-stage flow on cross-domain clusters.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  memories,
  memoryConnections,
  memoryImplications,
  contacts,
} from "@/db/schema";
import { eq, sql, and, or } from "drizzle-orm";
import { embedTexts } from "./embed";

// ── Types ──────────────────────────────────────────────────────────────

interface LLMConnection {
  memoryAId: string;
  memoryBId: string;
  connectionType: string;
  reason: string;
}

interface LLMImplication {
  content: string;
  implicationType: string;
  sourceMemoryIds: string[];
  order: number;
}

interface ConsolidationResult {
  clustersProcessed: number;
  antiClustersProcessed: number;
  connectionsCreated: number;
  connectionsStrengthened: number;
  implicationsCreated: number;
  implicationsReinforced: number;
  implicationsFiltered: number;
  opusCalls: number;
}

// ── Similarity thresholds ────────────────────────────────────────────

const CLUSTER_SIMILARITY = 0.65;
const MAX_CLUSTER_SIZE = 15;
const MIN_CLUSTER_SIZE = 3;
const IMPLICATION_DEDUP_THRESHOLD = 0.75;
const QUALITY_GATE_THRESHOLD = 4; // Only store implications scoring 4+ out of 5

// ── Main entry point ───────────────────────────────────────────────

export async function consolidateMemories(
  userId: string,
  options?: { timeoutMs?: number }
): Promise<ConsolidationResult> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const result: ConsolidationResult = {
    clustersProcessed: 0,
    antiClustersProcessed: 0,
    connectionsCreated: 0,
    connectionsStrengthened: 0,
    implicationsCreated: 0,
    implicationsReinforced: 0,
    implicationsFiltered: 0,
    opusCalls: 0,
  };

  // 1. Get all memories for this user that have embeddings
  const allMemories = await db
    .select({
      id: memories.id,
      content: memories.content,
      sourceDate: memories.sourceDate,
      strength: memories.strength,
      activationCount: memories.activationCount,
    })
    .from(memories)
    .where(
      and(eq(memories.userId, userId), sql`${memories.embedding} IS NOT NULL`)
    );

  if (allMemories.length < MIN_CLUSTER_SIZE) {
    console.log(
      `[consolidate] Only ${allMemories.length} memories — need at least ${MIN_CLUSTER_SIZE}`
    );
    return result;
  }

  console.log(
    `[consolidate] Finding clusters among ${allMemories.length} memories`
  );

  // 2. Find semantic clusters
  const clusters = await findSemanticClusters(userId, allMemories);
  console.log(`[consolidate] Found ${clusters.length} clusters`);

  if (clusters.length === 0) return result;

  // 3. Get contacts for name resolution in prompt
  const allContacts = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  // 4. Process each cluster through 3-stage pipeline
  for (const cluster of clusters) {
    try {
      await processCluster(cluster, allContacts, userId, timeoutMs, result, false);
      result.clustersProcessed++;
    } catch (error) {
      console.error(`[consolidate] Cluster processing failed:`, error);
    }
  }

  // 5. Anti-clustering pass
  try {
    const antiClusters = await findAntiClusters(userId, allMemories);
    console.log(`[consolidate] Found ${antiClusters.length} anti-clusters`);

    for (const cluster of antiClusters) {
      try {
        await processCluster(cluster, allContacts, userId, timeoutMs, result, true);
        result.antiClustersProcessed++;
      } catch (error) {
        console.error(`[consolidate] Anti-cluster processing failed:`, error);
      }
    }
  } catch (error) {
    console.error(`[consolidate] Anti-clustering pass failed:`, error);
  }

  console.log(
    `[consolidate] Done: ${result.clustersProcessed} clusters, ${result.antiClustersProcessed} anti-clusters, ` +
    `${result.connectionsCreated} new connections, ${result.connectionsStrengthened} strengthened, ` +
    `${result.implicationsCreated} new implications, ${result.implicationsFiltered} filtered by quality gate, ` +
    `${result.opusCalls} Opus calls`
  );

  return result;
}

// ── 3-stage cluster processing ──────────────────────────────────────

async function processCluster(
  cluster: MemoryRef[],
  allContacts: { id: string; name: string }[],
  userId: string,
  timeoutMs: number,
  result: ConsolidationResult,
  isAntiCluster: boolean
): Promise<void> {
  // Stage 1: Discover connections (Sonnet)
  const connections = await discoverConnections(cluster, allContacts, timeoutMs, isAntiCluster);

  for (const conn of connections) {
    const stored = await storeConnection(userId, conn);
    if (stored === "created") result.connectionsCreated++;
    else if (stored === "strengthened") result.connectionsStrengthened++;
  }

  console.log(
    `[consolidate] ${isAntiCluster ? "Anti-cluster" : "Cluster"}: ${connections.length} connections`
  );

  // Stage 2: Synthesize implication (Opus)
  const implications = await synthesizeImplications(
    cluster, connections, allContacts, timeoutMs, isAntiCluster
  );
  result.opusCalls++;

  // Stage 3: Quality gate (Haiku) + store
  for (const impl of implications) {
    const sourceContents = impl.sourceMemoryIds
      .map((id) => cluster.find((m) => m.id === id)?.content)
      .filter(Boolean) as string[];

    const passes = await qualityGate(impl.content, sourceContents, timeoutMs);

    if (passes) {
      const stored = await storeImplication(userId, impl);
      if (stored === "created") result.implicationsCreated++;
      else if (stored === "reinforced") result.implicationsReinforced++;
    } else {
      result.implicationsFiltered++;
      console.log(
        `[consolidate] Quality gate filtered: "${impl.content.slice(0, 80)}..."`
      );
    }
  }
}

// ── Semantic clustering ────────────────────────────────────────────

interface MemoryRef {
  id: string;
  content: string;
  sourceDate: string;
  strength: number;
  activationCount: number;
}

async function findSemanticClusters(
  userId: string,
  allMemories: MemoryRef[]
): Promise<MemoryRef[][]> {
  const seeds = [...allMemories]
    .sort((a, b) => b.strength * b.activationCount - a.strength * a.activationCount)
    .slice(0, 10);

  const clusters: MemoryRef[][] = [];
  const clusteredIds = new Set<string>();

  for (const seed of seeds) {
    if (clusteredIds.has(seed.id)) continue;

    const neighbors = await db.execute(sql`
      SELECT id, content, source_date, strength, activation_count,
        1 - (embedding <=> (SELECT embedding FROM memories WHERE id = ${seed.id})) as similarity
      FROM memories
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
        AND id != ${seed.id}
        AND 1 - (embedding <=> (SELECT embedding FROM memories WHERE id = ${seed.id})) > ${CLUSTER_SIMILARITY}
      ORDER BY similarity DESC
      LIMIT ${MAX_CLUSTER_SIZE - 1}
    `);

    const neighborRows = neighbors.rows as Array<{
      id: string;
      content: string;
      source_date: string;
      strength: number;
      activation_count: number;
      similarity: number;
    }>;

    if (neighborRows.length < MIN_CLUSTER_SIZE - 1) continue;

    const cluster: MemoryRef[] = [seed];
    for (const row of neighborRows) {
      if (!clusteredIds.has(row.id)) {
        cluster.push({
          id: row.id,
          content: row.content,
          sourceDate: row.source_date,
          strength: row.strength,
          activationCount: row.activation_count,
        });
      }
    }

    if (cluster.length >= MIN_CLUSTER_SIZE) {
      clusters.push(cluster);
      for (const m of cluster) clusteredIds.add(m.id);
    }
  }

  return clusters;
}

// ── Anti-clustering ────────────────────────────────────────────────

const ANTI_CLUSTER_MAX_SURFACE_SIM = 0.35;
const ANTI_CLUSTER_MIN_ABSTRACT_SIM = 0.55;
const ANTI_CLUSTER_SEEDS = 5;
const ANTI_CLUSTER_NEIGHBORS = 5;

async function findAntiClusters(
  userId: string,
  allMemories: MemoryRef[]
): Promise<MemoryRef[][]> {
  const abstractCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM memories
    WHERE user_id = ${userId} AND abstract_embedding IS NOT NULL
  `);
  const hasAbstracts =
    parseInt((abstractCount.rows[0] as { count: string }).count, 10) >= 10;

  if (!hasAbstracts) {
    console.log(`[consolidate] Skipping anti-clustering — not enough abstract embeddings`);
    return [];
  }

  const shuffled = [...allMemories].sort(() => Math.random() - 0.5);
  const seeds = shuffled.slice(0, ANTI_CLUSTER_SEEDS);

  const antiClusters: MemoryRef[][] = [];
  const usedIds = new Set<string>();

  for (const seed of seeds) {
    if (usedIds.has(seed.id)) continue;

    const neighbors = await db.execute(sql`
      SELECT id, content, source_date, strength, activation_count,
        1 - (embedding <=> (SELECT embedding FROM memories WHERE id = ${seed.id})) as raw_sim,
        1 - (abstract_embedding <=> (SELECT abstract_embedding FROM memories WHERE id = ${seed.id})) as abstract_sim
      FROM memories
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
        AND abstract_embedding IS NOT NULL
        AND id != ${seed.id}
        AND 1 - (embedding <=> (SELECT embedding FROM memories WHERE id = ${seed.id})) < ${ANTI_CLUSTER_MAX_SURFACE_SIM}
        AND 1 - (abstract_embedding <=> (SELECT abstract_embedding FROM memories WHERE id = ${seed.id})) > ${ANTI_CLUSTER_MIN_ABSTRACT_SIM}
      ORDER BY abstract_sim DESC
      LIMIT ${ANTI_CLUSTER_NEIGHBORS}
    `);

    const neighborRows = neighbors.rows as Array<{
      id: string;
      content: string;
      source_date: string;
      strength: number;
      activation_count: number;
      raw_sim: number;
      abstract_sim: number;
    }>;

    if (neighborRows.length < 2) continue;

    const cluster: MemoryRef[] = [seed];
    for (const row of neighborRows) {
      if (!usedIds.has(row.id)) {
        cluster.push({
          id: row.id,
          content: row.content,
          sourceDate: row.source_date,
          strength: row.strength,
          activationCount: row.activation_count,
        });
      }
    }

    if (cluster.length >= 3) {
      antiClusters.push(cluster);
      for (const m of cluster) usedIds.add(m.id);
    }
  }

  return antiClusters;
}

// ── Stage 1: Discover connections (Sonnet) ──────────────────────────

async function discoverConnections(
  cluster: MemoryRef[],
  allContacts: { id: string; name: string }[],
  timeoutMs: number,
  isAntiCluster: boolean
): Promise<LLMConnection[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[consolidate] ANTHROPIC_API_KEY is not set!");
    return [];
  }

  const client = new Anthropic({ timeout: timeoutMs });

  const contactListStr =
    allContacts.length > 0
      ? allContacts.map((c) => `- "${c.name}" (id: "${c.id}")`).join("\n")
      : "(no contacts yet)";

  const memoriesFormatted = cluster
    .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate))
    .map((m) => `[${m.id}] ${m.sourceDate} — ${m.content}`)
    .join("\n");

  const antiClusterPreamble = isAntiCluster
    ? `\n\n## IMPORTANT: CROSS-DOMAIN ANALYSIS MODE
These memories appear UNRELATED on the surface but share deeper structural or emotional similarities. Find NON-OBVIOUS connections — shared patterns across different life domains, people, and timeframes. Look for:
- Cross-domain analogies (same behavioral pattern in different life areas)
- Shared emotional undercurrents across seemingly unrelated events
- Behavioral patterns with the same underlying structure despite different surfaces
- Contradictions or tensions visible only when juxtaposing distant memories\n`
    : "";

  const prompt = `You are analyzing memories from Dhruv's personal journal to discover meaningful connections between specific pairs of memories.${isAntiCluster ? " These memories appear unrelated on the surface but may share deeper structural patterns." : " These memories are semantically related but may span different dates and contexts."}

Use "you" (second person) when referring to Dhruv.

Known contacts: ${contactListStr}
${antiClusterPreamble}
## Memories:
${memoriesFormatted}

Find meaningful connections between specific pairs of memories. Return 1-4 connections maximum. Every connection must reveal something that isn't apparent from either memory alone. If you can't find a genuinely non-obvious connection, return fewer.

Return ONLY valid JSON:
{
  "connections": [
    {
      "memoryAId": "id of first memory",
      "memoryBId": "id of second memory",
      "connectionType": "causal" | "thematic" | "contradiction" | "pattern" | "temporal_sequence" | "cross_domain" | "sensory" | "deviation" | "escalation",
      "reason": "Why these are meaningfully connected — be specific, not generic (1-3 sentences)"
    }
  ]
}

## Connection quality bar:

BAD: "Both memories mention Theo Strauss" (entity co-occurrence isn't a connection)
BAD: "Both are about your social life" (surface-level thematic grouping)
GOOD: "Your decision to start morning runs may be causally linked to your improved sleep — the timing lines up and morning exercise is known to improve sleep quality."
GOOD: "You use the same initiative-driven approach in your personal life (cold-emailing for a private tour) as in your professional life (cold-emailing researchers). This 'just reach out' pattern is core to how you operate across domains."

RULES:
1. ONLY non-obvious connections. If the connection is apparent from reading either memory alone, don't include it.
2. Reasons must be SELF-CONTAINED — someone reading this alone should understand the insight.
3. Use FULL NAMES. Always first AND last.
4. Fewer, better connections > many mediocre ones. 1-4 max.`;

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const response = await stream.finalMessage();
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[consolidate] No JSON in connection response`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as { connections: LLMConnection[] };
    const clusterIds = new Set(cluster.map((m) => m.id));

    return (parsed.connections || []).filter((c) => {
      if (!clusterIds.has(c.memoryAId) || !clusterIds.has(c.memoryBId)) return false;
      if (!c.reason || c.reason.length < 10) return false;
      return true;
    });
  } catch (error) {
    console.error("[consolidate] Connection discovery failed:", error);
    return [];
  }
}

// ── Stage 2: Synthesize implications (Opus) ─────────────────────────

async function synthesizeImplications(
  cluster: MemoryRef[],
  connections: LLMConnection[],
  allContacts: { id: string; name: string }[],
  timeoutMs: number,
  isAntiCluster: boolean
): Promise<LLMImplication[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic({ timeout: timeoutMs });

  const memoriesFormatted = cluster
    .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate))
    .map((m) => `[${m.id}] ${m.sourceDate} — ${m.content}`)
    .join("\n");

  const connectionsFormatted = connections.length > 0
    ? connections
        .map((c) => {
          const memA = cluster.find((m) => m.id === c.memoryAId);
          const memB = cluster.find((m) => m.id === c.memoryBId);
          return `- "${memA?.content.slice(0, 80)}..." ↔ "${memB?.content.slice(0, 80)}..."\n  Type: ${c.connectionType} — ${c.reason}`;
        })
        .join("\n")
    : "(no connections discovered)";

  const contactListStr =
    allContacts.length > 0
      ? allContacts.map((c) => `"${c.name}"`).join(", ")
      : "(no contacts)";

  const prompt = `You are synthesizing a single insight from a cluster of Dhruv's memories and their discovered connections. Write as "you" (second person).${isAntiCluster ? " These memories appear unrelated on the surface — look for deep structural patterns." : ""}

Your job: find the ONE most profound implication this cluster reveals — something Dhruv probably hasn't noticed, that would change how he thinks about himself, his relationships, or his patterns.

Known contacts: ${contactListStr}

## Memories:
${memoriesFormatted}

## Discovered connections:
${connectionsFormatted}

## Rules:
1. ONE implication only. Pick the deepest, most non-obvious one. If nothing is genuinely profound, return an empty array.
2. MUST be self-contained. Someone reading this alone must fully understand it — include names, dates, and what happened.
3. MUST cite specific memories by referencing what happened, when, and with whom. Not "based on several memories" — "based on your argument with Nivitha on Feb 3 and your conversation with Theo about vulnerability on Jan 28."
4. MUST go beyond first-order. Don't just describe what happened. Ask "and what does THAT mean?" at least once.
5. Write like a perceptive friend, not a therapist. Direct, warm, specific. No therapy-speak.
6. 2-4 sentences max. Every word earns its place.
7. Use FULL NAMES (first AND last).

Return ONLY valid JSON:
{
  "implications": [
    {
      "content": "The implication — direct, grounded, non-obvious",
      "implicationType": "predictive" | "emotional" | "relational" | "identity" | "behavioral" | "actionable" | "absence" | "trajectory" | "meta_cognitive" | "retrograde" | "counterfactual",
      "sourceMemoryIds": ["2-5 memory IDs that support this"],
      "order": 1 | 2 | 3
    }
  ]
}

If nothing is genuinely insightful, return { "implications": [] }. Silence is better than noise.`;

  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const response = await stream.finalMessage();
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[consolidate] No JSON in implication response`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as { implications: LLMImplication[] };
    const clusterIds = new Set(cluster.map((m) => m.id));

    return (parsed.implications || []).filter((impl) => {
      if (!impl.content || impl.content.length < 20) return false;
      if (!Array.isArray(impl.sourceMemoryIds) || impl.sourceMemoryIds.length < 1) return false;
      if (!impl.sourceMemoryIds.some((id) => clusterIds.has(id))) return false;
      return true;
    });
  } catch (error) {
    console.error("[consolidate] Implication synthesis failed:", error);
    return [];
  }
}

// ── Stage 3: Quality gate (Haiku) ──────────────────────────────────

async function qualityGate(
  implication: string,
  sourceMemoryContents: string[],
  timeoutMs: number
): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return true;

  const client = new Anthropic({ timeout: Math.min(timeoutMs, 15_000) });

  const memoriesStr = sourceMemoryContents
    .slice(0, 5)
    .map((c) => `- ${c}`)
    .join("\n");

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16,
      messages: [
        {
          role: "user",
          content: `Score this insight on a 1-5 scale. Return ONLY a single digit.

Insight: "${implication}"

Based on these memories:
${memoriesStr}

Scoring:
5 = Genuinely surprising, specific, would change how someone thinks about themselves
4 = Insightful and well-grounded, not immediately obvious from the memories
3 = Reasonable observation but somewhat expected
2 = Surface-level pattern description, obvious from the memories
1 = Generic, vague, could apply to anyone

Return ONLY a single digit (1-5).`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const score = parseInt(text.charAt(0), 10);

    if (isNaN(score)) {
      console.warn(`[consolidate] Quality gate non-numeric: "${text}" — passing through`);
      return true;
    }

    console.log(
      `[consolidate] Quality gate: score=${score} for "${implication.slice(0, 60)}..."`
    );

    return score >= QUALITY_GATE_THRESHOLD;
  } catch (error) {
    console.error("[consolidate] Quality gate failed:", error);
    return true; // On error, pass through
  }
}

// ── Store connection (with Hebbian strengthening) ──────────────────

async function storeConnection(
  userId: string,
  conn: LLMConnection
): Promise<"created" | "strengthened" | "skipped"> {
  const [idA, idB] =
    conn.memoryAId < conn.memoryBId
      ? [conn.memoryAId, conn.memoryBId]
      : [conn.memoryBId, conn.memoryAId];

  const existing = await db
    .select()
    .from(memoryConnections)
    .where(
      and(
        eq(memoryConnections.memoryAId, idA),
        eq(memoryConnections.memoryBId, idB)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const delta = 0.1;
    const oldWeight = existing[0].weight;
    const newWeight = oldWeight + delta * (1 - oldWeight);

    await db
      .update(memoryConnections)
      .set({
        weight: newWeight,
        lastCoActivatedAt: new Date(),
        ...(conn.reason.length > (existing[0].reason?.length ?? 0)
          ? { reason: conn.reason, connectionType: conn.connectionType }
          : {}),
      })
      .where(eq(memoryConnections.id, existing[0].id));

    await db
      .update(memories)
      .set({
        activationCount: sql`${memories.activationCount} + 1`,
        strength: sql`${memories.strength} + 0.05`,
        lastActivatedAt: new Date(),
      })
      .where(or(eq(memories.id, idA), eq(memories.id, idB)));

    return "strengthened";
  }

  await db.insert(memoryConnections).values({
    userId,
    memoryAId: idA,
    memoryBId: idB,
    connectionType: conn.connectionType,
    weight: 0.5,
    reason: conn.reason,
  });

  return "created";
}

// ── Store implication (with semantic dedup) ─────────────────────────

async function storeImplication(
  userId: string,
  impl: LLMImplication
): Promise<"created" | "reinforced" | "skipped"> {
  const [embedding] = await embedTexts([impl.content]);

  const similar = await db.execute(sql`
    SELECT id, content, 1 - (embedding <=> ${sql.raw(`'[${embedding.join(",")}]'`)}::vector) as similarity
    FROM memory_implications
    WHERE user_id = ${userId}
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${sql.raw(`'[${embedding.join(",")}]'`)}::vector) > ${IMPLICATION_DEDUP_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 1
  `);

  const rows = similar.rows as Array<{
    id: string;
    content: string;
    similarity: number;
  }>;

  if (rows.length > 0) {
    await db
      .update(memoryImplications)
      .set({
        strength: sql`${memoryImplications.strength} + 0.1`,
        lastReinforcedAt: new Date(),
      })
      .where(eq(memoryImplications.id, rows[0].id));

    console.log(
      `[consolidate] Reinforced implication (sim=${rows[0].similarity.toFixed(3)}): "${rows[0].content.slice(0, 60)}..."`
    );
    return "reinforced";
  }

  await db.insert(memoryImplications).values({
    userId,
    content: impl.content,
    embedding,
    implicationType: impl.implicationType,
    implicationOrder: impl.order ?? 1,
    sourceMemoryIds: JSON.stringify(impl.sourceMemoryIds),
    strength: 1.0,
  });

  return "created";
}
