import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memoryClusters } from "@/db/schema";
import { eq } from "drizzle-orm";
import { embedSingle } from "@/lib/memory/embed";
import { projectToClusters } from "@/lib/memory/cluster";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { paragraph } = await request.json();

  if (!paragraph || typeof paragraph !== "string" || paragraph.trim().length < 10) {
    return NextResponse.json({ x: 0.5, y: 0.5, similarities: [] });
  }

  try {
    // 1. Fetch cached cluster centroids
    const clusterRows = await db
      .select()
      .from(memoryClusters)
      .where(eq(memoryClusters.userId, session.user.id));

    if (clusterRows.length === 0) {
      return NextResponse.json({ x: 0.5, y: 0.5, similarities: [] });
    }

    const clusters = clusterRows.map((c) => ({
      centroid: JSON.parse(c.centroid as unknown as string) as number[],
      x: c.posX,
      y: c.posY,
    }));

    // 2. Embed paragraph
    const embedding = await embedSingle(paragraph.trim());

    // 3. Project
    const { x, y, similarities } = projectToClusters(embedding, clusters);

    return NextResponse.json({ x, y, similarities });
  } catch (error) {
    console.error("[gravity-project] Error:", error);
    return NextResponse.json({ x: 0.5, y: 0.5, similarities: [] });
  }
}
