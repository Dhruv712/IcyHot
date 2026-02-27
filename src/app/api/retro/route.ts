import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { weeklyRetros } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateWeeklyRetro, type WeeklyRetroContent } from "@/lib/retro";
import { getUserTimeZone } from "@/lib/userTimeZone";
import { getMondayDateStringInTimeZone } from "@/lib/timezone";

export const maxDuration = 120;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timeZone = await getUserTimeZone(session.user.id);
  const weekStart = getMondayDateStringInTimeZone(new Date(), timeZone);

  // Try cached
  const [cached] = await db
    .select()
    .from(weeklyRetros)
    .where(
      and(
        eq(weeklyRetros.userId, session.user.id),
        eq(weeklyRetros.weekStart, weekStart)
      )
    );

  if (cached) {
    return NextResponse.json({
      retro: JSON.parse(cached.content) as WeeklyRetroContent,
      weekStart,
      cached: true,
    });
  }

  // Lazy-generate
  const retro = await generateWeeklyRetro(session.user.id, {
    timeZone,
    weekStart,
  });

  if (!retro) {
    return NextResponse.json({ retro: null, weekStart, cached: false });
  }

  return NextResponse.json({ retro, weekStart, cached: false });
}

// POST — force regenerate this week's retro
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timeZone = await getUserTimeZone(session.user.id);
  const weekStart = getMondayDateStringInTimeZone(new Date(), timeZone);

  // Delete cached
  await db
    .delete(weeklyRetros)
    .where(
      and(
        eq(weeklyRetros.userId, session.user.id),
        eq(weeklyRetros.weekStart, weekStart)
      )
    );

  const retro = await generateWeeklyRetro(session.user.id, {
    timeZone,
    weekStart,
  });

  return NextResponse.json({
    retro: retro || null,
    weekStart,
    cached: false,
    regenerated: true,
  });
}
