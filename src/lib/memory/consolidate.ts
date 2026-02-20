/**
 * Memory consolidation — Phase 2.
 * Discovers connections between memories and derives implications.
 * Uses semantic clustering + LLM analysis (Prompt B).
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
  implicationsDeduped: number;
}

// ── Similarity threshold for semantic clustering ────────────────────

const CLUSTER_SIMILARITY = 0.65; // Lower than dedup (0.92) — we want related, not duplicate
const MAX_CLUSTER_SIZE = 15; // Don't send too many memories to the LLM
const MIN_CLUSTER_SIZE = 3; // Need at least 3 memories for meaningful connections
const IMPLICATION_DEDUP_THRESHOLD = 0.75; // Similarity threshold for deduplicating implications (lowered from 0.80 — paraphrased implications need aggressive dedup)

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
    implicationsDeduped: 0,
  };

  // 0. Dedup existing implications (clean up any past duplicates)
  result.implicationsDeduped = await deduplicateImplications(userId);

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

  // 2. Find semantic clusters using K-nearest neighbors
  const clusters = await findSemanticClusters(userId, allMemories);
  console.log(`[consolidate] Found ${clusters.length} clusters`);

  if (clusters.length === 0) return result;

  // 3. Get contacts for name resolution in prompt
  const allContacts = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  // 4. Process each cluster
  for (const cluster of clusters) {
    try {
      const llmResult = await analyzeCluster(cluster, allContacts, timeoutMs);
      if (!llmResult) continue;

      // Store connections
      for (const conn of llmResult.connections) {
        const stored = await storeConnection(userId, conn);
        if (stored === "created") result.connectionsCreated++;
        else if (stored === "strengthened") result.connectionsStrengthened++;
      }

      // Store implications
      for (const impl of llmResult.implications) {
        const stored = await storeImplication(userId, impl);
        if (stored === "created") result.implicationsCreated++;
        else if (stored === "reinforced") result.implicationsReinforced++;
      }

      result.clustersProcessed++;
      console.log(
        `[consolidate] Cluster ${result.clustersProcessed}: ${llmResult.connections.length} connections, ${llmResult.implications.length} implications`
      );
    } catch (error) {
      console.error(`[consolidate] Cluster analysis failed:`, error);
    }
  }

  // 5. Anti-clustering pass — discover cross-domain connections
  try {
    const antiClusters = await findAntiClusters(userId, allMemories);
    console.log(`[consolidate] Found ${antiClusters.length} anti-clusters`);

    for (const cluster of antiClusters) {
      try {
        const llmResult = await analyzeCluster(
          cluster,
          allContacts,
          timeoutMs,
          true // isAntiCluster
        );
        if (!llmResult) continue;

        for (const conn of llmResult.connections) {
          const stored = await storeConnection(userId, conn);
          if (stored === "created") result.connectionsCreated++;
          else if (stored === "strengthened") result.connectionsStrengthened++;
        }

        for (const impl of llmResult.implications) {
          const stored = await storeImplication(userId, impl);
          if (stored === "created") result.implicationsCreated++;
          else if (stored === "reinforced") result.implicationsReinforced++;
        }

        result.antiClustersProcessed++;
        console.log(
          `[consolidate] Anti-cluster ${result.antiClustersProcessed}: ${llmResult.connections.length} connections, ${llmResult.implications.length} implications`
        );
      } catch (error) {
        console.error(`[consolidate] Anti-cluster analysis failed:`, error);
      }
    }
  } catch (error) {
    console.error(`[consolidate] Anti-clustering pass failed:`, error);
  }

  console.log(
    `[consolidate] Done: ${result.clustersProcessed} clusters, ${result.antiClustersProcessed} anti-clusters, ${result.connectionsCreated} new connections, ${result.connectionsStrengthened} strengthened, ${result.implicationsCreated} new implications, ${result.implicationsReinforced} reinforced`
  );

  return result;
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
  // Strategy: pick seed memories (strongest, most activated) and find their neighbors
  // Sort by strength * activationCount to prioritize important, frequently-seen memories
  const seeds = [...allMemories]
    .sort((a, b) => b.strength * b.activationCount - a.strength * a.activationCount)
    .slice(0, 10); // Top 10 seeds

  const clusters: MemoryRef[][] = [];
  const clusteredIds = new Set<string>();

  for (const seed of seeds) {
    if (clusteredIds.has(seed.id)) continue;

    // Find K nearest neighbors for this seed
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

    if (neighborRows.length < MIN_CLUSTER_SIZE - 1) continue; // Not enough neighbors

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

// ── Anti-clustering: find structurally similar but surface-dissimilar memories ─

const ANTI_CLUSTER_MAX_SURFACE_SIM = 0.35; // Must be far apart in raw embedding space
const ANTI_CLUSTER_MIN_ABSTRACT_SIM = 0.55; // But close in abstract embedding space
const ANTI_CLUSTER_SEEDS = 5;
const ANTI_CLUSTER_NEIGHBORS = 5;

async function findAntiClusters(
  userId: string,
  allMemories: MemoryRef[]
): Promise<MemoryRef[][]> {
  // Check if we have any abstract embeddings to work with
  const abstractCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM memories
    WHERE user_id = ${userId} AND abstract_embedding IS NOT NULL
  `);
  const hasAbstracts =
    parseInt((abstractCount.rows[0] as { count: string }).count, 10) >= 10;

  if (!hasAbstracts) {
    console.log(
      `[consolidate] Skipping anti-clustering — not enough abstract embeddings`
    );
    return [];
  }

  // Pick random seed memories (not the top-strength ones — we want diversity)
  const shuffled = [...allMemories].sort(() => Math.random() - 0.5);
  const seeds = shuffled.slice(0, ANTI_CLUSTER_SEEDS);

  const antiClusters: MemoryRef[][] = [];
  const usedIds = new Set<string>();

  for (const seed of seeds) {
    if (usedIds.has(seed.id)) continue;

    // Find memories that are FAR in raw embedding space but CLOSE in abstract embedding space
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

    if (neighborRows.length < 2) continue; // Need at least 2 neighbors + seed = 3

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

// ── LLM analysis ──────────────────────────────────────────────────

async function analyzeCluster(
  cluster: MemoryRef[],
  allContacts: { id: string; name: string }[],
  timeoutMs: number,
  isAntiCluster = false
): Promise<{ connections: LLMConnection[]; implications: LLMImplication[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[consolidate] ANTHROPIC_API_KEY is not set!");
    return null;
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
    ? `

## IMPORTANT: CROSS-DOMAIN ANALYSIS MODE
These memories were deliberately selected because they appear UNRELATED on the surface but share deeper structural or emotional similarities. Your primary job is to find the NON-OBVIOUS connections — the shared patterns across different life domains, people, and timeframes. Look especially for:
- Cross-domain analogies (the same behavioral pattern manifesting in different life areas)
- Shared emotional undercurrents across seemingly unrelated events
- Behavioral patterns that look different on the surface but have the same underlying structure
- Contradictions or tensions that only become visible when you juxtapose distant memories
- The same coping mechanism, relational dynamic, or decision-making pattern recurring in different contexts

Do NOT just say "these are unrelated." Dig deeper — the structural similarity is there.
`
    : "";

  const prompt = `You are analyzing a set of memories from Dhruv's personal memory system to discover connections between memories and derive implications from them.${isAntiCluster ? " These memories appear unrelated on the surface but may share deeper structural patterns." : " These memories were identified as semantically related but may span different dates and contexts."}

Use "you" (second person) when referring to Dhruv — never say "the user" or "Dhruv."

Known contacts (for reference):
${contactListStr}
${antiClusterPreamble}
## Memories to analyze:
${memoriesFormatted}
(Each memory shows: [ID] date — content)

Analyze these memories and identify:
1. CONNECTIONS: Meaningful relationships between specific pairs of memories
2. IMPLICATIONS: Higher-order insights, patterns, or predictions that emerge from considering these memories together — things you might not have noticed yourself

Return ONLY valid JSON (no markdown, no explanation):

{
  "connections": [
    {
      "memoryAId": "id of first memory",
      "memoryBId": "id of second memory",
      "connectionType": "causal" | "thematic" | "contradiction" | "pattern" | "temporal_sequence" | "cross_domain" | "sensory" | "deviation" | "escalation",
      "reason": "Why these memories are meaningfully connected — be specific and insightful, not generic (1-3 sentences)"
    }
  ],
  "implications": [
    {
      "content": "The implication or pattern, written as an insight for you in second person. Must be self-contained — someone reading this implication alone should fully understand it.",
      "implicationType": "predictive" | "emotional" | "relational" | "identity" | "behavioral" | "actionable" | "absence" | "trajectory" | "meta_cognitive" | "retrograde" | "counterfactual",
      "sourceMemoryIds": ["ids of the 2-5 memories that support this implication"],
      "order": 1 | 2 | 3
    }
  ]
}

## Connection Types (with examples):

Note: These examples are largely fictional, and are meant to be examples of quality.

CAUSAL: One memory directly causes, enables, or explains another.
  * Memory A: "On January 20, 2026, you decided to start running every morning in Berlin"
  * Memory B: "On February 2, 2026, you mentioned sleeping much better this week at your apartment in Berlin"
  * GOOD: "Your decision to start morning runs may be causally linked to your improved sleep — morning exercise is known to improve sleep quality, and the timing lines up."
  * BAD: "Both memories are about your health." (too vague — this is a thematic connection, not causal)

THEMATIC: Memories share an abstract theme even without shared entities or dates.
  * Memory A: "On January 15, 2026, you showed Nivitha Mavuluri the Powers of Ten film at the Eames house in Pacific Palisades"
  * Memory B: "On February 3, 2026, you showed Nivitha Mavuluri the Katz's Deli scene from When Harry Met Sally at your apartment in Paris"
  * GOOD: "You have a pattern of introducing Nivitha Mavuluri to cultural touchstones you love — sharing formative experiences is one of the ways you build intimacy."
  * BAD: "Both involve watching things with Nivitha Mavuluri." (surface-level observation, not a thematic insight)

CONTRADICTION: Memories that reveal internal tension, a gap between intention and reality, or conflicting signals.
  * Memory A: "On January 18, 2026, you committed to spending less time on your phone"
  * Memory B: "On January 26, 2026, you spent 3 hours scrolling Instagram on Sunday afternoon at your apartment in Paris"
  * GOOD: "This reveals a recurring intention-action gap with screen time — you recognize the problem but haven't found an effective mechanism to change the behavior."
  * BAD: "You said you'd use your phone less but then used it a lot." (just restating the facts, not analyzing the tension)

PATTERN / RECURRENCE: The same behavior, preference, or situation appears across multiple memories.
  * Memory A: "On January 22, 2026, Georg Von Manstein cancelled dinner plans last minute"
  * Memory B: "On February 1, 2026, Georg Von Manstein was a no-show for movie night at Fynn's apartment in Kreuzberg"
  * GOOD: "Georg Von Manstein has cancelled plans at least twice in two weeks — this appears to be a pattern rather than isolated incidents, and may indicate something going on in his life or a shift in the friendship dynamic."

TEMPORAL SEQUENCE: Memories form a meaningful narrative arc when placed in chronological order.
  * GOOD: "These three memories trace the full arc of your Ojai surprise for Ali Debow — from her mentioning she loves spas months earlier, to you secretly planning it, to her only realizing the destination at arrival. The arc reveals how much intentional thought you put into the relationship."

CROSS-DOMAIN ANALOGY: Memories from different life domains (work, personal, social) that share structural similarity.
  * Memory A: "On January 14, 2026, you cold-emailed the Eames Foundation to get a private tour"
  * Memory B: "On February 10, 2026, you and your cofounder cold-emailed three neuroscience professors at Stanford to pitch your project"
  * GOOD: "You use the same initiative-driven approach in your personal life (cold-emailing for a private tour) as in your professional life (cold-emailing researchers). This 'just reach out' pattern is a core part of how you operate across domains."

DEVIATION: A memory that represents a break from an established pattern, making both the pattern and the break significant.
  * GOOD: "You've meditated every morning for the past three weeks, but skipped it on February 8 — the day after your argument with Nivitha Mavuluri. The deviation suggests emotional disruption strong enough to break a well-established routine."

ESCALATION: Memories where the same type of thing keeps happening at increasing intensity.
  * GOOD: "Your conversations with Nivitha have escalated in emotional depth over the past month — from surface-level catch-ups to discussing family trauma to her reading you her father's letter. The relationship is deepening at an accelerating pace."

SENSORY / ATMOSPHERIC: Memories linked by shared sensory qualities (light, sound, setting) that reveal something about your inner state.
  * GOOD: "Sunlight appears in three memories from this period — flooding through your apartment window, the golden-hour flight to LA, and the glass wall at the hotel. Light seems to be a recurring positive sensory thread that correlates with your best emotional states."

## Implication Types (with examples):

PREDICTIVE: What is likely to happen based on observed patterns.
  * GOOD: "Based on your pattern of getting tiramisu gelato and pairing it with a fruity flavor on the last three occasions, if you go to a gelato shop in the near future, you'll likely order tiramisu paired with passion fruit or mango."
  * BAD: "You might get gelato again." (too vague, no grounding in the specific pattern)

EMOTIONAL: What memories imply about your emotional state or trajectory.
  * GOOD: "Nivitha Mavuluri's questioning on February 3 seems to have unlocked emotions you hadn't accessed in nearly two years. Combined with the career uncertainty you've been journaling about, you appear to be in an emotionally vulnerable but potentially transformative period."
  * BAD: "You seem emotional." (generic, no specificity)

RELATIONAL: What memories imply about the nature or trajectory of a relationship.
  * GOOD: "Your relationship with Sarah Hua seems to have shifted into a mostly functional mode — the last three interactions were all about coordinating logistics, with no mention of deeper conversation. This contrasts with six months ago when you described her as someone you could 'talk to about anything.'"

IDENTITY: What memories reveal about who you are at a deeper level — values, drives, self-concept.
  * GOOD: "Your daily push-up discipline since 2016, your morning runs despite dreading them, and your 'I can do more' memo all point to a core identity built around pushing past self-imposed limits. But your journal also reveals you 'don't fully trust yourself' — these may be two sides of the same coin: a drive to prove yourself that stems from feeling untrusted."

BEHAVIORAL: What memories reveal about how you characteristically act, decide, or respond.
  * GOOD: "You consistently optimize for the other person's experience when making plans — you skipped a restaurant because you weren't sure Nivitha Mavuluri would like the menu, you changed the meeting time to accommodate Theo Strauss's schedule, you picked the cafe closest to Fynn Comerford's apartment. This generosity is a strength but may also mean you deprioritize your own preferences."

ACTIONABLE: A concrete action that should be taken based on the memories.
  * GOOD: "You've mentioned three times that you need to call 311 about the garbage truck but haven't done it. You should either call this week or accept that the noise isn't actually bothering you enough to act on — the recurring 'I should but haven't' is itself a source of low-grade stress."
  * BAD: "You should call 311." (no context about why or the pattern behind it)

ABSENCE / GAP: What is conspicuously MISSING from the memory set that reveals something.
  * GOOD: "You haven't mentioned eating a real meal before 3pm on any of the last five weekdays. You may be under-eating or deprioritizing meals when you're in deep work mode — this could be affecting your afternoon energy levels."

TRAJECTORY / ARC: An insight that only emerges from seeing a sequence of memories as a trajectory, not individual data points.
  * GOOD: "Your last three weeks show a clear arc: operational intensity (meetings, logistics, launches) -> emotional opening (deep conversations with Nivitha Mavuluri, journaling about childhood) -> creative burst (three new project ideas in two days). You may need 'runway days' of high activity before you can access deeper emotional and creative states."

META-COGNITIVE: What your self-reflection reveals that you might not fully realize yourself.
  * GOOD: "You write that you 'don't trust yourself' because your parents didn't seem to trust you, and separately that you constantly feel you 'can do more.' These may be the same underlying pattern — a drive to prove yourself that stems from feeling untrusted, operating below your conscious awareness."

RETROGRADE: A new memory that changes the significance of an older memory.
  * GOOD: "Learning that Nivitha Mavuluri's father's letter 'almost perfectly described you' retroactively increases the significance of every memory showing your character traits — the surprise trip planning, buying that thoughtful birthday gift, staying patient during the argument. These weren't just nice moments; they were evidence of the person her father hoped she'd find."

COUNTERFACTUAL: Things that almost happened or were narrowly avoided, and what that implies.
  * GOOD: "If Theo Strauss hadn't offered for you to come work out of Bain Capital Ventures with him, you both never would have naturally realized that you wanted to be co-founders. You would likely still be looking into ultrasound technology."

## Rules:

1. ONLY create connections that reveal something NON-OBVIOUS. Don't connect memories just because they mention the same person or happened on the same day. The connection must surface a pattern, tension, cause, or insight that isn't apparent from either memory alone. If the connection is obvious (e.g., "both are about work"), don't include it.
   * BAD: "Both memories mention Theo Strauss" (entity co-occurrence alone is not a connection)
   * GOOD: "Theo Strauss's stress at dinner on January 22 may be linked to his company closing their seed round the week before — the pressures of running a newly-funded startup often manifest as social withdrawal"

2. PUSH FOR NTH-ORDER IMPLICATIONS. Don't stop at the obvious first-order implication. Ask "and what does THAT imply?" Keep going until you reach unfounded speculation, then step back one level. Mark the order (1, 2, or 3) for each implication.
   * First-order: "Your psychiatrist is unreliable about prescriptions"
   * Second-order: "You risk medication withdrawal, which could disrupt your productivity"
   * Third-order: "You should find a backup psychiatrist before this becomes a crisis"

3. IMPLICATIONS CAN COME FROM SINGLE MEMORIES OR CONNECTIONS. A single memory can have profound implications on its own. A connection between two memories can generate an implication that neither memory would produce alone. Look for both.

4. SELF-CONTAINED. Every connection reason and implication must make sense when read in isolation. Include enough context (names, dates, what happened) that someone could understand the insight without seeing the source memories.

5. GROUNDED, NOT SPECULATIVE. Every implication must be defensible from the specific memories provided. Cite 2-5 source memory IDs. If you're guessing, you've gone too far — step back.

6. HEDGE APPROPRIATELY. Use language like "this may suggest," "this could indicate," "it's possible that" for second and third-order implications. First-order implications that are well-supported can be stated more directly.

7. WRITE AS A THOUGHTFUL FRIEND. Warm but honest. Specific, not generic. Actionable, not preachy. You know Dhruv well and care about his growth — you're not a therapist giving clinical observations, you're a perceptive friend who notices things.

8. AIM FOR QUALITY. Don't force insights where none exist, but don't be conservative either — if you see it, surface it.

9. USE FULL NAMES. Always use first AND last names when referring to people, with their relationship context on first mention.`;

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const response = await stream.finalMessage();
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    console.log(
      `[consolidate] LLM response: stop_reason=${response.stop_reason}, length=${text.length}`
    );

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(
        `[consolidate] No JSON found. First 500 chars: ${text.slice(0, 500)}`
      );
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      connections: LLMConnection[];
      implications: LLMImplication[];
    };

    // Validate memory IDs exist in the cluster
    const clusterIds = new Set(cluster.map((m) => m.id));

    const validConnections = (parsed.connections || []).filter((c) => {
      if (!clusterIds.has(c.memoryAId) || !clusterIds.has(c.memoryBId)) {
        console.warn(
          `[consolidate] Connection references unknown memory ID — skipping`
        );
        return false;
      }
      if (!c.reason || c.reason.length < 10) return false;
      return true;
    });

    const validImplications = (parsed.implications || []).filter((impl) => {
      if (!impl.content || impl.content.length < 20) return false;
      if (
        !Array.isArray(impl.sourceMemoryIds) ||
        impl.sourceMemoryIds.length < 1
      )
        return false;
      // Verify at least one source memory is in the cluster
      if (!impl.sourceMemoryIds.some((id) => clusterIds.has(id))) return false;
      return true;
    });

    console.log(
      `[consolidate] Validated: ${validConnections.length} connections, ${validImplications.length} implications`
    );

    return { connections: validConnections, implications: validImplications };
  } catch (error) {
    console.error("[consolidate] LLM analysis failed:", error);
    return null;
  }
}

// ── Store connection (with Hebbian strengthening) ──────────────────

async function storeConnection(
  userId: string,
  conn: LLMConnection
): Promise<"created" | "strengthened" | "skipped"> {
  // Normalize order: always store smaller UUID first
  const [idA, idB] =
    conn.memoryAId < conn.memoryBId
      ? [conn.memoryAId, conn.memoryBId]
      : [conn.memoryBId, conn.memoryAId];

  // Check if connection already exists
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
    // Hebbian strengthening: w_new = w_old + delta * (1 - w_old)
    const delta = 0.1;
    const oldWeight = existing[0].weight;
    const newWeight = oldWeight + delta * (1 - oldWeight);

    await db
      .update(memoryConnections)
      .set({
        weight: newWeight,
        lastCoActivatedAt: new Date(),
        // Update reason if the new one is longer/better
        ...(conn.reason.length > (existing[0].reason?.length ?? 0)
          ? { reason: conn.reason, connectionType: conn.connectionType }
          : {}),
      })
      .where(eq(memoryConnections.id, existing[0].id));

    // Also bump activation on both memories (Hebbian co-activation)
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

  // Insert new connection
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
  // Embed the implication text
  const [embedding] = await embedTexts([impl.content]);

  // Check for semantic duplicates
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
    // Reinforce existing implication
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

  // Insert new implication
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

// ── Dedup existing implications ─────────────────────────────────────

async function deduplicateImplications(userId: string): Promise<number> {
  // Get all implications for this user, ordered by strength desc (keep the strongest)
  const allImplications = await db
    .select({
      id: memoryImplications.id,
      content: memoryImplications.content,
      strength: memoryImplications.strength,
    })
    .from(memoryImplications)
    .where(
      and(
        eq(memoryImplications.userId, userId),
        sql`${memoryImplications.embedding} IS NOT NULL`
      )
    )
    .orderBy(sql`${memoryImplications.strength} DESC`);

  if (allImplications.length < 2) return 0;

  const idsToDelete: string[] = [];
  const kept = new Set<string>();

  for (const impl of allImplications) {
    if (idsToDelete.includes(impl.id)) continue;
    if (kept.has(impl.id)) continue;

    kept.add(impl.id);

    // Find duplicates of this implication (similar above threshold)
    const duplicates = await db.execute(sql`
      SELECT id, content, strength,
        1 - (embedding <=> (SELECT embedding FROM memory_implications WHERE id = ${impl.id})) as similarity
      FROM memory_implications
      WHERE user_id = ${userId}
        AND id != ${impl.id}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> (SELECT embedding FROM memory_implications WHERE id = ${impl.id})) > ${IMPLICATION_DEDUP_THRESHOLD}
      ORDER BY similarity DESC
    `);

    const dupRows = duplicates.rows as Array<{
      id: string;
      content: string;
      strength: number;
      similarity: number;
    }>;

    for (const dup of dupRows) {
      if (!kept.has(dup.id) && !idsToDelete.includes(dup.id)) {
        idsToDelete.push(dup.id);
        console.log(
          `[consolidate] Dedup: removing "${dup.content.slice(0, 60)}..." (sim=${dup.similarity.toFixed(3)}) — keeping "${impl.content.slice(0, 60)}..."`
        );
      }
    }
  }

  if (idsToDelete.length > 0) {
    for (let i = 0; i < idsToDelete.length; i += 10) {
      const batch = idsToDelete.slice(i, i + 10);
      await db
        .delete(memoryImplications)
        .where(
          sql`${memoryImplications.id} IN (${sql.join(batch.map((id) => sql`${id}`), sql`, `)})`
        );
    }
    console.log(
      `[consolidate] Deduped ${idsToDelete.length} duplicate implications`
    );
  }

  return idsToDelete.length;
}
