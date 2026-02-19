import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memories, memoryConnections, memoryImplications } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { UMAP } from "umap-js";

export const maxDuration = 60;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Fetch all data in parallel
  const [allMemories, allConnections, allImplications] = await Promise.all([
    db.execute(sql`
      SELECT id, content, source, source_date, contact_ids, strength,
             activation_count, embedding::text as embedding_text
      FROM memories
      WHERE user_id = ${userId} AND embedding IS NOT NULL
      ORDER BY created_at DESC
    `),

    db
      .select({
        memoryAId: memoryConnections.memoryAId,
        memoryBId: memoryConnections.memoryBId,
        weight: memoryConnections.weight,
        connectionType: memoryConnections.connectionType,
        reason: memoryConnections.reason,
      })
      .from(memoryConnections)
      .where(eq(memoryConnections.userId, userId)),

    db
      .select({
        id: memoryImplications.id,
        content: memoryImplications.content,
        sourceMemoryIds: memoryImplications.sourceMemoryIds,
        implicationType: memoryImplications.implicationType,
      })
      .from(memoryImplications)
      .where(eq(memoryImplications.userId, userId)),
  ]);

  const memoryRows = allMemories.rows as Array<{
    id: string;
    content: string;
    source: string;
    source_date: string;
    contact_ids: string | null;
    strength: number;
    activation_count: number;
    embedding_text: string;
  }>;

  // Count connections per memory
  const connectionCounts = new Map<string, number>();
  for (const conn of allConnections) {
    connectionCounts.set(
      conn.memoryAId,
      (connectionCounts.get(conn.memoryAId) ?? 0) + 1
    );
    connectionCounts.set(
      conn.memoryBId,
      (connectionCounts.get(conn.memoryBId) ?? 0) + 1
    );
  }

  // Parse embeddings for UMAP
  const embeddings: number[][] = [];
  const validIndices: number[] = [];

  for (let i = 0; i < memoryRows.length; i++) {
    const row = memoryRows[i];
    if (row.embedding_text) {
      try {
        // Embedding stored as "[0.1,0.2,...]" text
        const parsed = JSON.parse(row.embedding_text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          embeddings.push(parsed);
          validIndices.push(i);
        }
      } catch {
        // Skip malformed embeddings
      }
    }
  }

  // Compute UMAP projection
  let umapCoords: number[][] = [];
  if (embeddings.length >= 15) {
    try {
      const umap = new UMAP({
        nNeighbors: Math.min(15, Math.floor(embeddings.length / 2)),
        minDist: 0.1,
        nComponents: 2,
        spread: 1.0,
      });
      const projection = umap.fit(embeddings);

      // Normalize to [0, 1]
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [px, py] of projection) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;

      umapCoords = projection.map(([px, py]) => [
        (px - minX) / rangeX,
        (py - minY) / rangeY,
      ]);
    } catch (e) {
      console.error("[memory-graph] UMAP computation failed:", e);
      // Fall back to no UMAP coords
    }
  }

  // Build UMAP lookup (validIndex → umap coords)
  const umapMap = new Map<number, [number, number]>();
  for (let i = 0; i < validIndices.length; i++) {
    if (umapCoords[i]) {
      umapMap.set(validIndices[i], [umapCoords[i][0], umapCoords[i][1]]);
    }
  }

  // Build nodes
  const nodes = memoryRows.map((row, idx) => {
    const coords = umapMap.get(idx);
    return {
      id: row.id,
      content: row.content.length > 120 ? row.content.slice(0, 117) + "..." : row.content,
      fullContent: row.content,
      sourceDate: row.source_date,
      strength: row.strength,
      activationCount: row.activation_count,
      source: row.source,
      contactIds: row.contact_ids ? JSON.parse(row.contact_ids) : [],
      connectionCount: connectionCounts.get(row.id) ?? 0,
      ux: coords ? coords[0] : Math.random(),
      uy: coords ? coords[1] : Math.random(),
    };
  });

  // Build edges
  const edges = allConnections.map((conn) => ({
    source: conn.memoryAId,
    target: conn.memoryBId,
    weight: conn.weight,
    connectionType: conn.connectionType,
    reason: conn.reason,
  }));

  // Build implications
  const implications = allImplications.map((impl) => ({
    id: impl.id,
    content: impl.content,
    sourceMemoryIds: JSON.parse(impl.sourceMemoryIds),
    implicationType: impl.implicationType,
  }));

  return NextResponse.json({
    nodes,
    edges,
    implications,
  });
}
