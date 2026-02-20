/**
 * Memory retrieval — Phase 3.
 * Spreading activation: embed query → seed memories → hop through connections → score → collect implications.
 * Applies Hebbian co-activation to strengthen retrieved connections.
 */

import { db } from "@/db";
import {
  memories,
  memoryConnections,
  memoryImplications,
} from "@/db/schema";
import { eq, sql, and, or } from "drizzle-orm";
import { embedSingle } from "./embed";

// ── Types ──────────────────────────────────────────────────────────────

export interface RetrievedMemory {
  id: string;
  content: string;
  strength: number;
  activationScore: number; // Combined relevance for this query
  contactIds: string[];
  sourceDate: string;
  hop: number; // 0 = seed (direct match), 1 = hop 1, 2 = hop 2
  viaImplication?: string; // If discovered through implication-mediated retrieval, the bridging implication content
}

export interface RetrievedImplication {
  id: string;
  content: string;
  implicationType: string | null;
  implicationOrder: number | null;
  strength: number;
  relevance: number; // How many of its source memories were activated
  sourceMemoryIds: string[]; // IDs of memories that generated this implication
}

export interface RetrievedConnection {
  fromId: string;
  toId: string;
  weight: number;
  connectionType: string | null;
  reason: string | null;
}

export interface RetrievalResult {
  memories: RetrievedMemory[];
  implications: RetrievedImplication[];
  connections: RetrievedConnection[];
  query: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_MAX_MEMORIES = 20;
const DEFAULT_MAX_HOPS = 2;
const DEFAULT_MIN_STRENGTH = 0.1;
const SEED_COUNT = 10; // Top K seeds from vector search
const HOP_DISCOUNT = 0.5; // Each hop reduces activation by 50%
const HEBBIAN_DELTA = 0.05; // Smaller delta for retrieval co-activation (vs 0.1 for consolidation)

// Entity diversity constants
const MAX_PER_ENTITY = 3; // Max results per contact before diversity penalty kicks in
const OVER_REP_THRESHOLD = 0.3; // Entity in >30% of candidates = over-represented
const DIVERSITY_WEIGHT = 0.3; // Score = 0.7 × activation + 0.3 × diversity

// ── Decay function ─────────────────────────────────────────────────────

function effectiveStrength(
  strength: number,
  lastActivatedAt: Date,
  connectionCount: number
): number {
  const daysSince =
    (Date.now() - lastActivatedAt.getTime()) / (1000 * 60 * 60 * 24);
  const halfLife = connectionCount > 0 ? 60 : 30; // Connected memories last 2x longer
  const decay = Math.exp((-Math.LN2 / halfLife) * daysSince);
  return strength * decay;
}

// ── Entity diversity reranking ─────────────────────────────────────────

/**
 * MMR-style greedy reranking that balances activation score with entity diversity.
 * Prevents any single contact from dominating results.
 * Memories with no contactIds (personal reflections) are never penalized.
 */
function diversifyByEntity<
  T extends { contactIds: string[]; activationScore: number }
>(candidates: T[], maxResults: number): T[] {
  if (candidates.length <= maxResults) return candidates;

  // Build entity frequency histogram
  const entityFreq = new Map<string, number>();
  for (const c of candidates) {
    for (const cid of c.contactIds) {
      entityFreq.set(cid, (entityFreq.get(cid) ?? 0) + 1);
    }
  }

  // Find over-represented entities
  const threshold = OVER_REP_THRESHOLD * candidates.length;
  const overRepEntities = new Set<string>();
  for (const [entity, count] of entityFreq) {
    if (count > threshold) overRepEntities.add(entity);
  }

  // Fast path: no over-representation → return top N as-is
  if (overRepEntities.size === 0) return candidates.slice(0, maxResults);

  // Normalize activation scores
  const maxActivation = candidates[0]?.activationScore ?? 1;

  // Greedy MMR selection
  const selected: T[] = [];
  const remaining = new Set(candidates.map((_, i) => i));
  const entityCounts = new Map<string, number>();

  while (selected.length < maxResults && remaining.size > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const idx of remaining) {
      const candidate = candidates[idx];
      const normalizedActivation =
        maxActivation > 0 ? candidate.activationScore / maxActivation : 0;

      // Compute diversity bonus
      let diversityBonus = 1.0;
      if (candidate.contactIds.length > 0) {
        for (const cid of candidate.contactIds) {
          if (overRepEntities.has(cid)) {
            const currentCount = entityCounts.get(cid) ?? 0;
            if (currentCount >= MAX_PER_ENTITY) {
              diversityBonus = 0;
              break;
            }
            diversityBonus = Math.min(
              diversityBonus,
              1.0 - currentCount / MAX_PER_ENTITY
            );
          }
        }
      }
      // Memories with no contactIds get full diversity bonus (never penalized)

      const mmrScore =
        (1 - DIVERSITY_WEIGHT) * normalizedActivation +
        DIVERSITY_WEIGHT * diversityBonus;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;

    const chosen = candidates[bestIdx];
    selected.push(chosen);
    remaining.delete(bestIdx);

    // Update entity counts
    for (const cid of chosen.contactIds) {
      entityCounts.set(cid, (entityCounts.get(cid) ?? 0) + 1);
    }
  }

  return selected;
}

/**
 * Diversify implications by the entity signature of their source memories.
 */
function diversifyImplications(
  implications: RetrievedImplication[],
  activatedMap: Map<string, { contactIds: string[] }>,
  maxResults: number
): RetrievedImplication[] {
  if (implications.length <= maxResults) return implications;

  // Compute entity signature for each implication from its source memories
  const withEntities = implications.map((impl) => {
    const entities = new Set<string>();
    for (const sid of impl.sourceMemoryIds) {
      const mem = activatedMap.get(sid);
      if (mem) {
        for (const cid of mem.contactIds) entities.add(cid);
      }
    }
    return {
      impl,
      contactIds: Array.from(entities),
      activationScore: impl.relevance * impl.strength,
    };
  });

  // Sort by score descending
  withEntities.sort((a, b) => b.activationScore - a.activationScore);

  // Apply same diversity logic
  const diversified = diversifyByEntity(withEntities, maxResults);
  return diversified.map((d) => d.impl);
}

// ── Main retrieval function ────────────────────────────────────────────

export async function retrieveMemories(
  userId: string,
  query: string,
  options?: {
    maxMemories?: number;
    maxHops?: number;
    contactFilter?: string;
    minStrength?: number;
    skipHebbian?: boolean; // Skip co-activation updates (for read-only queries)
    diversify?: boolean; // Entity diversity reranking (default true, auto-disabled with contactFilter)
  }
): Promise<RetrievalResult> {
  const maxMemories = options?.maxMemories ?? DEFAULT_MAX_MEMORIES;
  const maxHops = options?.maxHops ?? DEFAULT_MAX_HOPS;
  const minStrength = options?.minStrength ?? DEFAULT_MIN_STRENGTH;
  const skipHebbian = options?.skipHebbian ?? false;
  const shouldDiversify = (options?.diversify !== false) && !options?.contactFilter;

  // 1. Embed the query
  const queryEmbedding = await embedSingle(query);

  // 2. Find seed memories (direct vector similarity)
  const seedQuery = sql`
    SELECT
      id, content, strength, activation_count, contact_ids, source_date, last_activated_at,
      1 - (embedding <=> ${sql.raw(`'[${queryEmbedding.join(",")}]'`)}::vector) as similarity
    FROM memories
    WHERE user_id = ${userId}
      AND embedding IS NOT NULL
      ${options?.contactFilter ? sql`AND contact_ids LIKE ${"%" + options.contactFilter + "%"}` : sql``}
    ORDER BY similarity DESC
    LIMIT ${SEED_COUNT}
  `;

  const seedRows = (
    await db.execute(seedQuery)
  ).rows as Array<{
    id: string;
    content: string;
    strength: number;
    activation_count: number;
    contact_ids: string | null;
    source_date: string;
    last_activated_at: string;
    similarity: number;
  }>;

  // Track all activated memories with their scores
  const activatedMap = new Map<
    string,
    {
      id: string;
      content: string;
      strength: number;
      contactIds: string[];
      sourceDate: string;
      activationScore: number;
      hop: number;
      connectionCount: number;
      lastActivatedAt: Date;
    }
  >();

  // Count connections per memory for decay calculation
  const connectionCounts = await getConnectionCounts(userId, seedRows.map((r) => r.id));

  // Process seeds (hop 0)
  for (const row of seedRows) {
    const connCount = connectionCounts.get(row.id) ?? 0;
    const decayedStrength = effectiveStrength(
      row.strength,
      new Date(row.last_activated_at),
      connCount
    );

    if (decayedStrength < minStrength) continue;

    const activationScore = row.similarity * decayedStrength;

    activatedMap.set(row.id, {
      id: row.id,
      content: row.content,
      strength: decayedStrength,
      contactIds: row.contact_ids ? JSON.parse(row.contact_ids) : [],
      sourceDate: row.source_date,
      activationScore,
      hop: 0,
      connectionCount: connCount,
      lastActivatedAt: new Date(row.last_activated_at),
    });
  }

  // 3. Spreading activation — hop through connections
  let currentFrontier = new Set(activatedMap.keys());
  const allConnections: RetrievedConnection[] = [];

  for (let hop = 1; hop <= maxHops; hop++) {
    if (currentFrontier.size === 0) break;

    const nextFrontier = new Set<string>();
    const hopDiscount = Math.pow(HOP_DISCOUNT, hop);

    // Find all connections from the current frontier
    const frontierIds = Array.from(currentFrontier);
    const connRows = await findConnections(userId, frontierIds);

    for (const conn of connRows) {
      // Determine which side is in the frontier and which is the neighbor
      const isAInFrontier = currentFrontier.has(conn.memory_a_id);
      const neighborId = isAInFrontier ? conn.memory_b_id : conn.memory_a_id;
      const sourceId = isAInFrontier ? conn.memory_a_id : conn.memory_b_id;

      // Track connection for visualization
      allConnections.push({
        fromId: sourceId,
        toId: neighborId,
        weight: conn.weight,
        connectionType: conn.connection_type,
        reason: conn.reason,
      });

      // Skip if already activated (but still record the connection)
      if (activatedMap.has(neighborId)) continue;

      // Calculate activation for the neighbor
      const sourceActivation = activatedMap.get(sourceId)?.activationScore ?? 0;
      const propagatedScore = sourceActivation * conn.weight * hopDiscount;

      if (propagatedScore < 0.01) continue; // Too weak to bother

      // Fetch the neighbor memory
      const neighborMemory = await db
        .select({
          id: memories.id,
          content: memories.content,
          strength: memories.strength,
          contactIds: memories.contactIds,
          sourceDate: memories.sourceDate,
          lastActivatedAt: memories.lastActivatedAt,
        })
        .from(memories)
        .where(eq(memories.id, neighborId))
        .limit(1);

      if (neighborMemory.length === 0) continue;

      const neighbor = neighborMemory[0];
      const nConnCount = connectionCounts.get(neighborId) ?? 0;
      const decayedStrength = effectiveStrength(
        neighbor.strength,
        neighbor.lastActivatedAt,
        nConnCount
      );

      if (decayedStrength < minStrength) continue;

      // Apply contact filter
      if (options?.contactFilter) {
        const nContactIds = neighbor.contactIds
          ? JSON.parse(neighbor.contactIds)
          : [];
        if (!nContactIds.includes(options.contactFilter)) continue;
      }

      activatedMap.set(neighborId, {
        id: neighbor.id,
        content: neighbor.content,
        strength: decayedStrength,
        contactIds: neighbor.contactIds
          ? JSON.parse(neighbor.contactIds)
          : [],
        sourceDate: neighbor.sourceDate,
        activationScore: propagatedScore,
        hop,
        connectionCount: nConnCount,
        lastActivatedAt: neighbor.lastActivatedAt,
      });

      nextFrontier.add(neighborId);
    }

    currentFrontier = nextFrontier;
  }

  // 4. Sort by activation score, take top N
  const sortedMemories = Array.from(activatedMap.values())
    .sort((a, b) => b.activationScore - a.activationScore)
    .slice(0, maxMemories);

  const activatedIds = new Set(sortedMemories.map((m) => m.id));

  // 5. Collect implications whose source memories overlap with activated set
  let implications = await findRelevantImplications(userId, activatedIds);

  // Diversify implications by entity signature
  if (shouldDiversify) {
    implications = diversifyImplications(implications, activatedMap, 10);
  }

  // 5b. Implication-mediated discovery — find implications semantically similar to query,
  //     then pull in their source memories even if those memories are distant in embedding space
  const implicationBridgedMemories: Array<{
    id: string;
    content: string;
    strength: number;
    activationScore: number;
    contactIds: string[];
    sourceDate: string;
    hop: number;
    viaImplication: string;
  }> = [];

  try {
    const queryImplications = await findImplicationsByQuery(
      userId,
      queryEmbedding,
      activatedIds
    );

    for (const impl of queryImplications) {
      const sourceIds: string[] = JSON.parse(
        typeof impl.sourceMemoryIds === "string"
          ? impl.sourceMemoryIds
          : JSON.stringify(impl.sourceMemoryIds)
      );

      for (const sourceId of sourceIds) {
        if (activatedIds.has(sourceId)) continue; // Already in results

        // Fetch the bridged memory
        const bridgedRows = await db
          .select({
            id: memories.id,
            content: memories.content,
            strength: memories.strength,
            contactIds: memories.contactIds,
            sourceDate: memories.sourceDate,
            lastActivatedAt: memories.lastActivatedAt,
          })
          .from(memories)
          .where(eq(memories.id, sourceId))
          .limit(1);

        if (bridgedRows.length === 0) continue;

        const bridged = bridgedRows[0];
        const connCount = connectionCounts.get(sourceId) ?? 0;
        const decayedStrength = effectiveStrength(
          bridged.strength,
          bridged.lastActivatedAt,
          connCount
        );

        if (decayedStrength < minStrength) continue;

        const activationScore = impl.similarity * decayedStrength * 0.3; // 0.3x discount for implication-bridged

        activatedIds.add(sourceId);
        implicationBridgedMemories.push({
          id: bridged.id,
          content: bridged.content,
          strength: decayedStrength,
          activationScore,
          contactIds: bridged.contactIds
            ? JSON.parse(bridged.contactIds)
            : [],
          sourceDate: bridged.sourceDate,
          hop: -1, // Special marker for implication-bridged
          viaImplication: impl.content,
        });

        // Also add this implication to results if not already there
        if (!implications.some((i) => i.id === impl.id)) {
          const bridgedSourceIds: string[] = JSON.parse(
            typeof impl.sourceMemoryIds === "string"
              ? impl.sourceMemoryIds
              : JSON.stringify(impl.sourceMemoryIds)
          );
          implications.push({
            id: impl.id,
            content: impl.content,
            implicationType: impl.implicationType,
            implicationOrder: impl.implicationOrder,
            strength: impl.strength,
            relevance: impl.similarity,
            sourceMemoryIds: bridgedSourceIds,
          });
        }
      }
    }
  } catch (error) {
    console.error(
      `[retrieve] Implication-mediated discovery failed:`,
      error
    );
    // Non-blocking — continue without bridged memories
  }

  // 6. Filter connections to only include those between activated memories
  const relevantConnections = allConnections.filter(
    (c) => activatedIds.has(c.fromId) && activatedIds.has(c.toId)
  );

  // 7. Hebbian co-activation — strengthen connections between co-retrieved memories
  if (!skipHebbian && sortedMemories.length >= 2) {
    await applyHebbianCoActivation(activatedIds, relevantConnections);
  }

  // Combine spreading-activation memories with implication-bridged memories
  let allResultMemories: RetrievedMemory[] = [
    ...sortedMemories.map((m) => ({
      id: m.id,
      content: m.content,
      strength: m.strength,
      activationScore: m.activationScore,
      contactIds: m.contactIds,
      sourceDate: m.sourceDate,
      hop: m.hop,
    })),
    ...implicationBridgedMemories,
  ];

  // Apply entity diversity to combined results
  if (shouldDiversify) {
    allResultMemories = diversifyByEntity(
      allResultMemories,
      maxMemories + MAX_BRIDGING_IMPLICATIONS
    );
  }

  return {
    memories: allResultMemories,
    implications,
    connections: relevantConnections,
    query,
  };
}

// ── Helper: count connections per memory ────────────────────────────

async function getConnectionCounts(
  userId: string,
  memoryIds: string[]
): Promise<Map<string, number>> {
  if (memoryIds.length === 0) return new Map();

  const rows = await db.execute(sql`
    SELECT memory_id, count(*) as cnt FROM (
      SELECT memory_a_id as memory_id FROM memory_connections WHERE user_id = ${userId}
      UNION ALL
      SELECT memory_b_id as memory_id FROM memory_connections WHERE user_id = ${userId}
    ) sub
    WHERE memory_id IN (${sql.join(memoryIds.map((id) => sql`${id}`), sql`, `)})
    GROUP BY memory_id
  `);

  const counts = new Map<string, number>();
  for (const row of rows.rows as Array<{ memory_id: string; cnt: string }>) {
    counts.set(row.memory_id, parseInt(row.cnt, 10));
  }
  return counts;
}

// ── Helper: find connections from frontier memories ─────────────────

async function findConnections(
  userId: string,
  frontierIds: string[]
): Promise<
  Array<{
    memory_a_id: string;
    memory_b_id: string;
    weight: number;
    connection_type: string | null;
    reason: string | null;
  }>
> {
  if (frontierIds.length === 0) return [];

  const rows = await db.execute(sql`
    SELECT memory_a_id, memory_b_id, weight, connection_type, reason
    FROM memory_connections
    WHERE user_id = ${userId}
      AND (
        memory_a_id IN (${sql.join(frontierIds.map((id) => sql`${id}`), sql`, `)})
        OR memory_b_id IN (${sql.join(frontierIds.map((id) => sql`${id}`), sql`, `)})
      )
  `);

  return rows.rows as Array<{
    memory_a_id: string;
    memory_b_id: string;
    weight: number;
    connection_type: string | null;
    reason: string | null;
  }>;
}

// ── Helper: find implications relevant to activated memories ────────

async function findRelevantImplications(
  userId: string,
  activatedIds: Set<string>
): Promise<RetrievedImplication[]> {
  if (activatedIds.size === 0) return [];

  // Get all implications for this user
  const allImplications = await db
    .select({
      id: memoryImplications.id,
      content: memoryImplications.content,
      implicationType: memoryImplications.implicationType,
      implicationOrder: memoryImplications.implicationOrder,
      strength: memoryImplications.strength,
      sourceMemoryIds: memoryImplications.sourceMemoryIds,
    })
    .from(memoryImplications)
    .where(eq(memoryImplications.userId, userId));

  const relevant: RetrievedImplication[] = [];

  for (const impl of allImplications) {
    const sourceIds: string[] = JSON.parse(impl.sourceMemoryIds);
    const overlapCount = sourceIds.filter((id) => activatedIds.has(id)).length;

    if (overlapCount === 0) continue;

    const relevance = overlapCount / sourceIds.length; // 0-1: what fraction of sources are activated

    relevant.push({
      id: impl.id,
      content: impl.content,
      implicationType: impl.implicationType,
      implicationOrder: impl.implicationOrder,
      strength: impl.strength,
      relevance,
      sourceMemoryIds: sourceIds,
    });
  }

  // Sort by relevance * strength, return top implications
  return relevant
    .sort((a, b) => b.relevance * b.strength - a.relevance * a.strength)
    .slice(0, 10);
}

// ── Helper: Hebbian co-activation for retrieved memories ──────────

async function applyHebbianCoActivation(
  activatedIds: Set<string>,
  connections: RetrievedConnection[]
): Promise<void> {
  // 1. Strengthen connections between co-retrieved memories
  for (const conn of connections) {
    const [idA, idB] =
      conn.fromId < conn.toId
        ? [conn.fromId, conn.toId]
        : [conn.toId, conn.fromId];

    await db
      .update(memoryConnections)
      .set({
        weight: sql`${memoryConnections.weight} + ${HEBBIAN_DELTA} * (1 - ${memoryConnections.weight})`,
        lastCoActivatedAt: new Date(),
      })
      .where(
        and(
          eq(memoryConnections.memoryAId, idA),
          eq(memoryConnections.memoryBId, idB)
        )
      );
  }

  // 2. Bump activation on all retrieved memories
  const ids = Array.from(activatedIds);
  if (ids.length > 0) {
    await db
      .update(memories)
      .set({
        activationCount: sql`${memories.activationCount} + 1`,
        lastActivatedAt: new Date(),
      })
      .where(
        sql`${memories.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
      );
  }
}

// ── Helper: find implications by query embedding (implication-mediated discovery) ─

const IMPLICATION_QUERY_THRESHOLD = 0.5;
const MAX_BRIDGING_IMPLICATIONS = 5;

async function findImplicationsByQuery(
  userId: string,
  queryEmbedding: number[],
  alreadyActivated: Set<string>
): Promise<
  Array<{
    id: string;
    content: string;
    implicationType: string | null;
    implicationOrder: number | null;
    strength: number;
    similarity: number;
    sourceMemoryIds: string;
  }>
> {
  const rows = await db.execute(sql`
    SELECT id, content, implication_type, implication_order, strength, source_memory_ids,
      1 - (embedding <=> ${sql.raw(`'[${queryEmbedding.join(",")}]'`)}::vector) as similarity
    FROM memory_implications
    WHERE user_id = ${userId}
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${sql.raw(`'[${queryEmbedding.join(",")}]'`)}::vector) > ${IMPLICATION_QUERY_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT ${MAX_BRIDGING_IMPLICATIONS * 2}
  `);

  const results = (
    rows.rows as Array<{
      id: string;
      content: string;
      implication_type: string | null;
      implication_order: number | null;
      strength: number;
      source_memory_ids: string;
      similarity: number;
    }>
  ).filter((row) => {
    // Only include implications that have at least one source memory NOT already activated
    const sourceIds: string[] = JSON.parse(row.source_memory_ids);
    return sourceIds.some((id) => !alreadyActivated.has(id));
  });

  return results.slice(0, MAX_BRIDGING_IMPLICATIONS).map((row) => ({
    id: row.id,
    content: row.content,
    implicationType: row.implication_type,
    implicationOrder: row.implication_order,
    strength: row.strength,
    similarity: row.similarity,
    sourceMemoryIds: row.source_memory_ids,
  }));
}
