import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { weeklyRetros } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateWeeklyRetro, type WeeklyRetroContent } from "@/lib/retro";

export const maxDuration = 120;

function getMonday(d: Date): string {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setUTCDate(diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekStart = getMonday(new Date());

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
  const retro = await generateWeeklyRetro(session.user.id);

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

  const weekStart = getMonday(new Date());

  // Delete cached
  await db
    .delete(weeklyRetros)
    .where(
      and(
        eq(weeklyRetros.userId, session.user.id),
        eq(weeklyRetros.weekStart, weekStart)
      )
    );

  const retro = await generateWeeklyRetro(session.user.id);

  return NextResponse.json({
    retro: retro || null,
    weekStart,
    cached: false,
    regenerated: true,
  });
}
