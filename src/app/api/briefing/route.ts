import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dailyBriefings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateDailyBriefing, type DailyBriefingContent } from "@/lib/briefing";

export const maxDuration = 30;

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
    return NextResponse.json({
      briefing: JSON.parse(cached.content) as DailyBriefingContent,
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
