import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  memories,
  memoryConnections,
  memoryImplications,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Run all stats queries in parallel
  const [
    memoryStats,
    connectionStats,
    implicationStats,
    recentlyActive,
    topConnectedMemories,
    connectionTypeBreakdown,
    implicationTypeBreakdown,
  ] = await Promise.all([
    // Total memories + avg strength
    db.execute(sql`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(strength), 0) as avg_strength,
        COALESCE(AVG(activation_count), 0) as avg_activation_count
      FROM memories
      WHERE user_id = ${userId}
    `),

    // Total connections + avg weight
    db.execute(sql`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(weight), 0) as avg_weight
      FROM memory_connections
      WHERE user_id = ${userId}
    `),

    // Total implications + avg strength
    db.execute(sql`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(strength), 0) as avg_strength
      FROM memory_implications
      WHERE user_id = ${userId}
    `),

    // Recently active (last 7 days)
    db.execute(sql`
      SELECT COUNT(*) as count
      FROM memories
      WHERE user_id = ${userId}
        AND last_activated_at > NOW() - INTERVAL '7 days'
    `),

    // Top 5 most connected memories
    db.execute(sql`
      SELECT m.id, m.content, m.strength, m.source_date, sub.conn_count
      FROM memories m
      INNER JOIN (
        SELECT memory_id, COUNT(*) as conn_count FROM (
          SELECT memory_a_id as memory_id FROM memory_connections WHERE user_id = ${userId}
          UNION ALL
          SELECT memory_b_id as memory_id FROM memory_connections WHERE user_id = ${userId}
        ) edges
        GROUP BY memory_id
        ORDER BY conn_count DESC
        LIMIT 5
      ) sub ON m.id = sub.memory_id
      ORDER BY sub.conn_count DESC
    `),

    // Connection type breakdown
    db.execute(sql`
      SELECT connection_type, COUNT(*) as count
      FROM memory_connections
      WHERE user_id = ${userId} AND connection_type IS NOT NULL
      GROUP BY connection_type
      ORDER BY count DESC
    `),

    // Implication type breakdown
    db.execute(sql`
      SELECT implication_type, implication_order, COUNT(*) as count
      FROM memory_implications
      WHERE user_id = ${userId} AND implication_type IS NOT NULL
      GROUP BY implication_type, implication_order
      ORDER BY count DESC
    `),
  ]);

  const mStats = memoryStats.rows[0] as {
    total: string;
    avg_strength: string;
    avg_activation_count: string;
  };
  const cStats = connectionStats.rows[0] as {
    total: string;
    avg_weight: string;
  };
  const iStats = implicationStats.rows[0] as {
    total: string;
    avg_strength: string;
  };
  const recent = recentlyActive.rows[0] as { count: string };

  return NextResponse.json({
    success: true,
    memories: {
      total: parseInt(mStats.total, 10),
      avgStrength: parseFloat(parseFloat(mStats.avg_strength).toFixed(3)),
      avgActivationCount: parseFloat(
        parseFloat(mStats.avg_activation_count).toFixed(1)
      ),
    },
    connections: {
      total: parseInt(cStats.total, 10),
      avgWeight: parseFloat(parseFloat(cStats.avg_weight).toFixed(3)),
      byType: (
        connectionTypeBreakdown.rows as Array<{
          connection_type: string;
          count: string;
        }>
      ).map((r) => ({
        type: r.connection_type,
        count: parseInt(r.count, 10),
      })),
    },
    implications: {
      total: parseInt(iStats.total, 10),
      avgStrength: parseFloat(parseFloat(iStats.avg_strength).toFixed(3)),
      byType: (
        implicationTypeBreakdown.rows as Array<{
          implication_type: string;
          implication_order: number;
          count: string;
        }>
      ).map((r) => ({
        type: r.implication_type,
        order: r.implication_order,
        count: parseInt(r.count, 10),
      })),
    },
    recentlyActive: parseInt(recent.count, 10),
    topConnectedMemories: (
      topConnectedMemories.rows as Array<{
        id: string;
        content: string;
        strength: number;
        source_date: string;
        conn_count: string;
      }>
    ).map((r) => ({
      id: r.id,
      content: r.content,
      strength: r.strength,
      sourceDate: r.source_date,
      connectionCount: parseInt(r.conn_count, 10),
    })),
  });
}
