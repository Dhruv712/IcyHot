import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dailyBriefings, provocations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateDailyBriefing, type DailyBriefingContent, type BriefingProvocation } from "@/lib/briefing";

export const maxDuration = 60;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Try to read cached briefing first
  const [cached] = await db
    .select()
    .from(dailyBriefings)
    .where(
      and(
        eq(dailyBriefings.userId, session.user.id),
        eq(dailyBriefings.briefingDate, today)
      )
    );

  if (cached) {
    const briefing = JSON.parse(cached.content) as DailyBriefingContent;

    // Always re-query provocations live — they change independently (dismissals, regenerations)
    try {
      const provRows = await db
        .select({
          id: provocations.id,
          triggerContent: provocations.triggerContent,
          provocation: provocations.provocation,
          supportingMemoryContents: provocations.supportingMemoryContents,
        })
        .from(provocations)
        .where(
          and(
            eq(provocations.userId, session.user.id),
            eq(provocations.date, today),
            eq(provocations.dismissed, false)
          )
        );

      const liveProvocations: BriefingProvocation[] = provRows.map((p) => ({
        id: p.id,
        triggerContent: p.triggerContent,
        provocation: p.provocation,
        supportingMemoryContents: JSON.parse(p.supportingMemoryContents),
      }));

      briefing.provocations = liveProvocations.length > 0 ? liveProvocations : undefined;
    } catch (error) {
      console.error("[briefing-api] Failed to query live provocations:", error);
    }

    return NextResponse.json({
      briefing,
      date: today,
      cached: true,
    });
  }

  // Generate on-demand if not cached (e.g., cron hasn't run yet)
  const briefing = await generateDailyBriefing(session.user.id);

  if (!briefing) {
    return NextResponse.json({ briefing: null, date: today, cached: false });
  }

  return NextResponse.json({
    briefing,
    date: today,
    cached: false,
  });
}

// POST — force regenerate today's briefing (invalidate cache + regenerate with Opus)
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Delete cached briefing for today
  await db
    .delete(dailyBriefings)
    .where(
      and(
        eq(dailyBriefings.userId, session.user.id),
        eq(dailyBriefings.briefingDate, today)
      )
    );

  // Regenerate
  const briefing = await generateDailyBriefing(session.user.id);

  return NextResponse.json({
    briefing: briefing || null,
    date: today,
    cached: false,
    regenerated: true,
  });
}
