import { and, desc, eq, gte, inArray, lte, lt } from "drizzle-orm";
import { db } from "@/db";
import { consolidationDigests, memories, memoryConnections, memoryImplications } from "@/db/schema";

type ConsolidationCounts = {
  clustersProcessed: number;
  antiClustersProcessed: number;
  connectionsCreated: number;
  connectionsStrengthened: number;
  implicationsCreated: number;
  implicationsReinforced: number;
  implicationsFiltered: number;
};

export interface ConsolidationConnectionDetail {
  id: string;
  memoryAId: string;
  memoryASnippet: string;
  memoryADate: string;
  memoryBId: string;
  memoryBSnippet: string;
  memoryBDate: string;
  connectionType: string | null;
  reason: string | null;
  weight: number;
  timestamp: string;
}

export interface ConsolidationImplicationDetail {
  id: string;
  content: string;
  implicationType: string | null;
  implicationOrder: number | null;
  strength: number;
  sourceMemoryIds: string[];
  sourceMemorySnippets: Array<{ id: string; sourceDate: string; snippet: string }>;
  timestamp: string;
}

export interface ConsolidationMemoryDetail {
  id: string;
  content: string;
  sourceDate: string;
  timestamp: string;
}

export interface ConsolidationDigestDetails {
  createdMemories: ConsolidationMemoryDetail[];
  createdConnections: ConsolidationConnectionDetail[];
  strengthenedConnections: ConsolidationConnectionDetail[];
  createdImplications: ConsolidationImplicationDetail[];
  reinforcedImplications: ConsolidationImplicationDetail[];
}

export interface ConsolidationDigestRecord {
  id: string;
  digestDate: string;
  timeZone: string;
  runStartedAt: string;
  runCompletedAt: string;
  counts: ConsolidationCounts;
  summary: string;
  changeCount: number;
  details: ConsolidationDigestDetails;
  createdAt: string;
}

interface CreateDigestOptions {
  userId: string;
  digestDate: string;
  timeZone: string;
  runStartedAt: Date;
  runCompletedAt: Date;
  counts: ConsolidationCounts;
}

function shortSnippet(text: string | null, maxLen = 160): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

function buildSummary(counts: ConsolidationCounts, createdMemoryCount: number): string {
  const parts: string[] = [];

  if (createdMemoryCount > 0) {
    parts.push(`${createdMemoryCount} new memor${createdMemoryCount === 1 ? "y" : "ies"}`);
  }
  if (counts.connectionsCreated > 0) {
    parts.push(`${counts.connectionsCreated} new connection${counts.connectionsCreated === 1 ? "" : "s"}`);
  }
  if (counts.connectionsStrengthened > 0) {
    parts.push(`${counts.connectionsStrengthened} strengthened link${counts.connectionsStrengthened === 1 ? "" : "s"}`);
  }
  if (counts.implicationsCreated > 0) {
    parts.push(`${counts.implicationsCreated} new implication${counts.implicationsCreated === 1 ? "" : "s"}`);
  }
  if (counts.implicationsReinforced > 0) {
    parts.push(`${counts.implicationsReinforced} reinforced implication${counts.implicationsReinforced === 1 ? "" : "s"}`);
  }

  if (parts.length === 0) {
    if (counts.implicationsFiltered > 0) {
      return `Consolidation ran, but ${counts.implicationsFiltered} low-utility implication${counts.implicationsFiltered === 1 ? " was" : "s were"} filtered.`;
    }
    return "Consolidation ran, but no new high-signal memories, connections, or implications were added.";
  }

  return `Overnight graph update: ${parts.join(", ")}.`;
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function gatherConnectionDetails(userId: string, runStartedAt: Date, runCompletedAt: Date): Promise<{
  createdConnections: ConsolidationConnectionDetail[];
  strengthenedConnections: ConsolidationConnectionDetail[];
}> {
  const baseSelect = {
    id: memoryConnections.id,
    memoryAId: memoryConnections.memoryAId,
    memoryBId: memoryConnections.memoryBId,
    connectionType: memoryConnections.connectionType,
    reason: memoryConnections.reason,
    weight: memoryConnections.weight,
    createdAt: memoryConnections.createdAt,
    lastCoActivatedAt: memoryConnections.lastCoActivatedAt,
  };

  const [createdRows, strengthenedRows] = await Promise.all([
    db
      .select(baseSelect)
      .from(memoryConnections)
      .where(
        and(
          eq(memoryConnections.userId, userId),
          gte(memoryConnections.createdAt, runStartedAt),
          lte(memoryConnections.createdAt, runCompletedAt),
        ),
      )
      .orderBy(desc(memoryConnections.createdAt))
      .limit(24),
    db
      .select(baseSelect)
      .from(memoryConnections)
      .where(
        and(
          eq(memoryConnections.userId, userId),
          lt(memoryConnections.createdAt, runStartedAt),
          gte(memoryConnections.lastCoActivatedAt, runStartedAt),
          lte(memoryConnections.lastCoActivatedAt, runCompletedAt),
        ),
      )
      .orderBy(desc(memoryConnections.lastCoActivatedAt))
      .limit(24),
  ]);

  const memoryIds = new Set<string>();
  for (const row of createdRows) {
    memoryIds.add(row.memoryAId);
    memoryIds.add(row.memoryBId);
  }
  for (const row of strengthenedRows) {
    memoryIds.add(row.memoryAId);
    memoryIds.add(row.memoryBId);
  }

  const memoryMap = new Map<string, { sourceDate: string; content: string }>();
  if (memoryIds.size > 0) {
    const memoryRows = await db
      .select({ id: memories.id, sourceDate: memories.sourceDate, content: memories.content })
      .from(memories)
      .where(inArray(memories.id, Array.from(memoryIds)));

    for (const row of memoryRows) {
      memoryMap.set(row.id, { sourceDate: row.sourceDate, content: row.content });
    }
  }

  const mapConnection = (
    row: (typeof createdRows)[number],
    timestamp: Date,
  ): ConsolidationConnectionDetail => {
    const memA = memoryMap.get(row.memoryAId);
    const memB = memoryMap.get(row.memoryBId);

    return {
      id: row.id,
      memoryAId: row.memoryAId,
      memoryASnippet: shortSnippet(memA?.content || ""),
      memoryADate: memA?.sourceDate || "",
      memoryBId: row.memoryBId,
      memoryBSnippet: shortSnippet(memB?.content || ""),
      memoryBDate: memB?.sourceDate || "",
      connectionType: row.connectionType,
      reason: row.reason,
      weight: Number((row.weight || 0).toFixed(3)),
      timestamp: timestamp.toISOString(),
    };
  };

  return {
    createdConnections: createdRows.map((row) => mapConnection(row, row.createdAt)),
    strengthenedConnections: strengthenedRows.map((row) => mapConnection(row, row.lastCoActivatedAt)),
  };
}

async function gatherCreatedMemoryDetails(
  userId: string,
  runStartedAt: Date,
  runCompletedAt: Date,
): Promise<ConsolidationMemoryDetail[]> {
  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      sourceDate: memories.sourceDate,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.source, "journal"),
        gte(memories.createdAt, runStartedAt),
        lte(memories.createdAt, runCompletedAt),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(24);

  return rows.map((row) => ({
    id: row.id,
    content: shortSnippet(row.content, 220),
    sourceDate: row.sourceDate,
    timestamp: row.createdAt.toISOString(),
  }));
}

async function gatherImplicationDetails(userId: string, runStartedAt: Date, runCompletedAt: Date): Promise<{
  createdImplications: ConsolidationImplicationDetail[];
  reinforcedImplications: ConsolidationImplicationDetail[];
}> {
  const baseSelect = {
    id: memoryImplications.id,
    content: memoryImplications.content,
    implicationType: memoryImplications.implicationType,
    implicationOrder: memoryImplications.implicationOrder,
    sourceMemoryIds: memoryImplications.sourceMemoryIds,
    strength: memoryImplications.strength,
    createdAt: memoryImplications.createdAt,
    lastReinforcedAt: memoryImplications.lastReinforcedAt,
  };

  const [createdRows, reinforcedRows] = await Promise.all([
    db
      .select(baseSelect)
      .from(memoryImplications)
      .where(
        and(
          eq(memoryImplications.userId, userId),
          gte(memoryImplications.createdAt, runStartedAt),
          lte(memoryImplications.createdAt, runCompletedAt),
        ),
      )
      .orderBy(desc(memoryImplications.createdAt))
      .limit(20),
    db
      .select(baseSelect)
      .from(memoryImplications)
      .where(
        and(
          eq(memoryImplications.userId, userId),
          lt(memoryImplications.createdAt, runStartedAt),
          gte(memoryImplications.lastReinforcedAt, runStartedAt),
          lte(memoryImplications.lastReinforcedAt, runCompletedAt),
        ),
      )
      .orderBy(desc(memoryImplications.lastReinforcedAt))
      .limit(20),
  ]);

  const sourceIds = new Set<string>();
  const addSourceIds = (rows: Array<{ sourceMemoryIds: string }>) => {
    for (const row of rows) {
      const parsed = safeParseJson<string[]>(row.sourceMemoryIds, []);
      for (const id of parsed) sourceIds.add(id);
    }
  };

  addSourceIds(createdRows);
  addSourceIds(reinforcedRows);

  const sourceMap = new Map<string, { sourceDate: string; content: string }>();
  if (sourceIds.size > 0) {
    const sourceRows = await db
      .select({ id: memories.id, sourceDate: memories.sourceDate, content: memories.content })
      .from(memories)
      .where(inArray(memories.id, Array.from(sourceIds)));

    for (const row of sourceRows) {
      sourceMap.set(row.id, { sourceDate: row.sourceDate, content: row.content });
    }
  }

  const mapImplication = (
    row: (typeof createdRows)[number],
    timestamp: Date,
  ): ConsolidationImplicationDetail => {
    const ids = safeParseJson<string[]>(row.sourceMemoryIds, []);
    const sourceMemorySnippets = ids
      .map((id) => {
        const source = sourceMap.get(id);
        if (!source) return null;
        return {
          id,
          sourceDate: source.sourceDate,
          snippet: shortSnippet(source.content, 120),
        };
      })
      .filter((item): item is { id: string; sourceDate: string; snippet: string } => Boolean(item));

    return {
      id: row.id,
      content: row.content,
      implicationType: row.implicationType,
      implicationOrder: row.implicationOrder,
      strength: Number((row.strength || 0).toFixed(3)),
      sourceMemoryIds: ids,
      sourceMemorySnippets,
      timestamp: timestamp.toISOString(),
    };
  };

  return {
    createdImplications: createdRows.map((row) => mapImplication(row, row.createdAt)),
    reinforcedImplications: reinforcedRows.map((row) => mapImplication(row, row.lastReinforcedAt)),
  };
}

function toDigestRecord(row: {
  id: string;
  digestDate: string;
  timeZone: string;
  runStartedAt: Date;
  runCompletedAt: Date;
  clustersProcessed: number;
  antiClustersProcessed: number;
  connectionsCreated: number;
  connectionsStrengthened: number;
  implicationsCreated: number;
  implicationsReinforced: number;
  implicationsFiltered: number;
  summary: string;
  details: string;
  createdAt: Date;
}): ConsolidationDigestRecord {
  const details = safeParseJson<ConsolidationDigestDetails>(row.details, {
    createdMemories: [],
    createdConnections: [],
    strengthenedConnections: [],
    createdImplications: [],
    reinforcedImplications: [],
  });

  const counts: ConsolidationCounts = {
    clustersProcessed: row.clustersProcessed,
    antiClustersProcessed: row.antiClustersProcessed,
    connectionsCreated: row.connectionsCreated,
    connectionsStrengthened: row.connectionsStrengthened,
    implicationsCreated: row.implicationsCreated,
    implicationsReinforced: row.implicationsReinforced,
    implicationsFiltered: row.implicationsFiltered,
  };

  return {
    id: row.id,
    digestDate: row.digestDate,
    timeZone: row.timeZone,
    runStartedAt: row.runStartedAt.toISOString(),
    runCompletedAt: row.runCompletedAt.toISOString(),
    counts,
    summary: row.summary,
    changeCount:
      details.createdMemories.length +
      counts.connectionsCreated +
      counts.connectionsStrengthened +
      counts.implicationsCreated +
      counts.implicationsReinforced,
    details,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createConsolidationDigest(
  options: CreateDigestOptions,
): Promise<ConsolidationDigestRecord> {
  const { userId, digestDate, timeZone, runStartedAt, runCompletedAt, counts } = options;

  const [createdMemories, connectionDetails, implicationDetails] = await Promise.all([
    gatherCreatedMemoryDetails(userId, runStartedAt, runCompletedAt),
    gatherConnectionDetails(userId, runStartedAt, runCompletedAt),
    gatherImplicationDetails(userId, runStartedAt, runCompletedAt),
  ]);

  const details: ConsolidationDigestDetails = {
    createdMemories,
    createdConnections: connectionDetails.createdConnections,
    strengthenedConnections: connectionDetails.strengthenedConnections,
    createdImplications: implicationDetails.createdImplications,
    reinforcedImplications: implicationDetails.reinforcedImplications,
  };

  const summary = buildSummary(counts, createdMemories.length);

  const [row] = await db
    .insert(consolidationDigests)
    .values({
      userId,
      digestDate,
      timeZone,
      runStartedAt,
      runCompletedAt,
      clustersProcessed: counts.clustersProcessed,
      antiClustersProcessed: counts.antiClustersProcessed,
      connectionsCreated: counts.connectionsCreated,
      connectionsStrengthened: counts.connectionsStrengthened,
      implicationsCreated: counts.implicationsCreated,
      implicationsReinforced: counts.implicationsReinforced,
      implicationsFiltered: counts.implicationsFiltered,
      summary,
      details: JSON.stringify(details),
    })
    .onConflictDoUpdate({
      target: [consolidationDigests.userId, consolidationDigests.digestDate],
      set: {
        timeZone,
        runStartedAt,
        runCompletedAt,
        clustersProcessed: counts.clustersProcessed,
        antiClustersProcessed: counts.antiClustersProcessed,
        connectionsCreated: counts.connectionsCreated,
        connectionsStrengthened: counts.connectionsStrengthened,
        implicationsCreated: counts.implicationsCreated,
        implicationsReinforced: counts.implicationsReinforced,
        implicationsFiltered: counts.implicationsFiltered,
        summary,
        details: JSON.stringify(details),
        createdAt: new Date(),
      },
    })
    .returning({
      id: consolidationDigests.id,
      digestDate: consolidationDigests.digestDate,
      timeZone: consolidationDigests.timeZone,
      runStartedAt: consolidationDigests.runStartedAt,
      runCompletedAt: consolidationDigests.runCompletedAt,
      clustersProcessed: consolidationDigests.clustersProcessed,
      antiClustersProcessed: consolidationDigests.antiClustersProcessed,
      connectionsCreated: consolidationDigests.connectionsCreated,
      connectionsStrengthened: consolidationDigests.connectionsStrengthened,
      implicationsCreated: consolidationDigests.implicationsCreated,
      implicationsReinforced: consolidationDigests.implicationsReinforced,
      implicationsFiltered: consolidationDigests.implicationsFiltered,
      summary: consolidationDigests.summary,
      details: consolidationDigests.details,
      createdAt: consolidationDigests.createdAt,
    });

  return toDigestRecord(row);
}

export async function getLatestConsolidationDigest(
  userId: string,
): Promise<ConsolidationDigestRecord | null> {
  const [row] = await db
    .select({
      id: consolidationDigests.id,
      digestDate: consolidationDigests.digestDate,
      timeZone: consolidationDigests.timeZone,
      runStartedAt: consolidationDigests.runStartedAt,
      runCompletedAt: consolidationDigests.runCompletedAt,
      clustersProcessed: consolidationDigests.clustersProcessed,
      antiClustersProcessed: consolidationDigests.antiClustersProcessed,
      connectionsCreated: consolidationDigests.connectionsCreated,
      connectionsStrengthened: consolidationDigests.connectionsStrengthened,
      implicationsCreated: consolidationDigests.implicationsCreated,
      implicationsReinforced: consolidationDigests.implicationsReinforced,
      implicationsFiltered: consolidationDigests.implicationsFiltered,
      summary: consolidationDigests.summary,
      details: consolidationDigests.details,
      createdAt: consolidationDigests.createdAt,
    })
    .from(consolidationDigests)
    .where(eq(consolidationDigests.userId, userId))
    .orderBy(desc(consolidationDigests.createdAt))
    .limit(1);

  return row ? toDigestRecord(row) : null;
}

export async function getConsolidationDigestByDate(
  userId: string,
  digestDate: string,
): Promise<ConsolidationDigestRecord | null> {
  const [row] = await db
    .select({
      id: consolidationDigests.id,
      digestDate: consolidationDigests.digestDate,
      timeZone: consolidationDigests.timeZone,
      runStartedAt: consolidationDigests.runStartedAt,
      runCompletedAt: consolidationDigests.runCompletedAt,
      clustersProcessed: consolidationDigests.clustersProcessed,
      antiClustersProcessed: consolidationDigests.antiClustersProcessed,
      connectionsCreated: consolidationDigests.connectionsCreated,
      connectionsStrengthened: consolidationDigests.connectionsStrengthened,
      implicationsCreated: consolidationDigests.implicationsCreated,
      implicationsReinforced: consolidationDigests.implicationsReinforced,
      implicationsFiltered: consolidationDigests.implicationsFiltered,
      summary: consolidationDigests.summary,
      details: consolidationDigests.details,
      createdAt: consolidationDigests.createdAt,
    })
    .from(consolidationDigests)
    .where(
      and(
        eq(consolidationDigests.userId, userId),
        eq(consolidationDigests.digestDate, digestDate),
      ),
    )
    .limit(1);

  return row ? toDigestRecord(row) : null;
}
