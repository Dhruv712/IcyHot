import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { syncJournalEntries } from "@/lib/journal";
import { syncCalendarEvents } from "@/lib/calendar";
import { generateDailyBriefing } from "@/lib/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allUsers = await db.select({ id: users.id }).from(users);

  const results: Array<{
    userId: string;
    journal: { success: boolean; error?: string };
    calendar: { success: boolean; error?: string };
    briefing: { success: boolean; error?: string };
  }> = [];

  for (const user of allUsers) {
    const result = {
      userId: user.id,
      journal: { success: false } as { success: boolean; error?: string },
      calendar: { success: false } as { success: boolean; error?: string },
      briefing: { success: false } as { success: boolean; error?: string },
    };

    try {
      await syncJournalEntries(user.id);
      result.journal = { success: true };
    } catch (error) {
      console.error(`[cron] Journal sync failed for ${user.id}:`, error);
      result.journal = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    try {
      await syncCalendarEvents(user.id);
      result.calendar = { success: true };
    } catch (error) {
      console.error(`[cron] Calendar sync failed for ${user.id}:`, error);
      result.calendar = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Generate daily briefing after sync completes
    try {
      await generateDailyBriefing(user.id);
      result.briefing = { success: true };
    } catch (error) {
      console.error(`[cron] Briefing generation failed for ${user.id}:`, error);
      result.briefing = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    results.push(result);
  }

  const allOk = results.every((r) => r.journal.success && r.calendar.success);

  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
