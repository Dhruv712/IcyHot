import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memoryClusters } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  kMeansClusters,
  layoutClusters,
  projectToClusters,
  type MemoryPoint,
} from "@/lib/memory/cluster";

export const maxDuration = 30;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // 1. Check for cached clusters (< 1 hour old)
  const cached = await db
    .select()
    .from(memoryClusters)
    .where(eq(memoryClusters.userId, userId))
    .limit(1);

  const isFresh =
    cached.length > 0 &&
    Date.now() - cached[0].computedAt.getTime() < CACHE_TTL_MS;

  if (isFresh) {
    // Return cached clusters + project all memories for starfield
    const clusterRows = await db
      .select()
      .from(memoryClusters)
      .where(eq(memoryClusters.userId, userId));

    // Fetch memories for starfield dots
    const memoryRows = await db.execute(sql`
      SELECT id, embedding::text as embedding_text, source, strength
      FROM memories
      WHERE user_id = ${userId} AND embedding IS NOT NULL
    `);

    const clusterData = clusterRows.map((c) => ({
      label: c.label,
      memberCount: c.memberCount,
      x: c.posX,
      y: c.posY,
      centroid: JSON.parse(c.centroid as unknown as string) as number[],
    }));

    const memoryDots = (memoryRows.rows as any[])
      .map((row) => {
        try {
          const emb = JSON.parse(row.embedding_text) as number[];
          const pos = projectToClusters(emb, clusterData);
          return {
            x: pos.x,
            y: pos.y,
            source: row.source as string,
            strength: row.strength as number,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return NextResponse.json({
      clusters: clusterData.map(({ centroid: _, ...rest }) => rest),
      memoryDots,
    });
  }

  // 2. Compute fresh clusters
  const allMemories = await db.execute(sql`
    SELECT id, content, embedding::text as embedding_text,
           contact_ids, source, strength
    FROM memories
    WHERE user_id = ${userId} AND embedding IS NOT NULL
    ORDER BY created_at DESC
  `);

  const memoryRows = allMemories.rows as any[];

  if (memoryRows.length < 4) {
    return NextResponse.json({ clusters: [], memoryDots: [] });
  }

  // Parse embeddings
  const memories: MemoryPoint[] = [];
  for (const row of memoryRows) {
    try {
      const embedding = JSON.parse(row.embedding_text) as number[];
      if (embedding.length === 1024) {
        memories.push({
          id: row.id,
          embedding,
          content: row.content,
          contactIds: row.contact_ids ? JSON.parse(row.contact_ids) : [],
          source: row.source,
          strength: row.strength,
        });
      }
    } catch {
      continue;
    }
  }

  if (memories.length < 4) {
    return NextResponse.json({ clusters: [], memoryDots: [] });
  }

  // K-means
  const k = Math.min(8, Math.max(3, Math.floor(memories.length / 15)));
  const clusters = kMeansClusters(memories, k);
  layoutClusters(clusters);

  // 3. Persist clusters to DB (delete old, insert new)
  await db
    .delete(memoryClusters)
    .where(eq(memoryClusters.userId, userId));

  if (clusters.length > 0) {
    await db.insert(memoryClusters).values(
      clusters.map((c) => ({
        userId,
        centroid: c.centroid,
        label: c.label,
        posX: c.x,
        posY: c.y,
        memberCount: c.memberCount,
        computedAt: new Date(),
      })),
    );
  }

  // 4. Project all memories for starfield
  const memoryDots = memories.map((m) => {
    const pos = projectToClusters(m.embedding, clusters);
    return {
      x: pos.x,
      y: pos.y,
      source: m.source,
      strength: m.strength,
    };
  });

  return NextResponse.json({
    clusters: clusters.map(({ centroid: _, memberIds: __, ...rest }) => rest),
    memoryDots,
  });
}
