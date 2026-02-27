import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, dailyBriefings, dailySuggestions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { syncJournalEntries } from "@/lib/journal";
import { syncCalendarEvents } from "@/lib/calendar";
import { commitDirtyDraftsToGithub } from "@/lib/github";
import { generateDailyBriefing } from "@/lib/briefing";
import { sendPushToUser } from "@/lib/push";
import { snapshotHealthScoreForDate } from "@/lib/health";
import { generateWeeklyRetro } from "@/lib/retro";
import { processMemories } from "@/lib/memory/pipeline";
import { consolidateMemories } from "@/lib/memory/consolidate";
import { generateProvocationsForUser } from "@/lib/memory/provoke";
import { createConsolidationDigest } from "@/lib/memory/consolidationDigest";
import {
  getDateStringInTimeZone,
  getWeekdayInTimeZone,
} from "@/lib/timezone";
import { getUserTimeZone } from "@/lib/userTimeZone";

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
    timeZone: string;
    localDate: string;
    journal: { success: boolean; error?: string };
    calendar: { success: boolean; error?: string };
    memory: { success: boolean; error?: string };
    consolidation: {
      success: boolean;
      digestDate?: string;
      summary?: string;
      changeCount?: number;
      error?: string;
    };
    overnightPush: {
      success: boolean;
      sent?: number;
      skipped?: string;
      error?: string;
    };
    provocations: { success: boolean; generated?: number; error?: string };
    briefing: { success: boolean; error?: string };
    push: { success: boolean; sent?: number; error?: string };
    healthSnapshot: { success: boolean; error?: string };
    retro?: { success: boolean; error?: string };
  }> = [];

  for (const user of allUsers) {
    const now = new Date();
    const timeZone = await getUserTimeZone(user.id);
    const today = getDateStringInTimeZone(now, timeZone);
    const isSunday = getWeekdayInTimeZone(now, timeZone) === 0;

    const result: (typeof results)[0] = {
      userId: user.id,
      timeZone,
      localDate: today,
      journal: { success: false },
      calendar: { success: false },
      memory: { success: false },
      consolidation: { success: false },
      overnightPush: { success: false },
      provocations: { success: false },
      briefing: { success: false },
      push: { success: false },
      healthSnapshot: { success: false },
    };

    let hasNewContent = false;

    // Commit any dirty drafts from the in-app editor to GitHub before syncing
    try {
      const commitResult = await commitDirtyDraftsToGithub(user.id);
      if (commitResult.committed > 0) {
        console.log(`[cron] Committed ${commitResult.committed} drafts to GitHub for ${user.id}`);
      }
    } catch (error) {
      console.error(`[cron] Draft commit failed for ${user.id}:`, error);
      // Non-blocking — journal sync can still pick up Obsidian entries
    }

    try {
      const journalResult = await syncJournalEntries(user.id);
      result.journal = { success: true };
      if (journalResult.processed > 0) hasNewContent = true;
    } catch (error) {
      console.error(`[cron] Journal sync failed for ${user.id}:`, error);
      result.journal = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    try {
      const calendarResult = await syncCalendarEvents(user.id);
      result.calendar = { success: true };
      if (calendarResult.created > 0) hasNewContent = true;
    } catch (error) {
      console.error(`[cron] Calendar sync failed for ${user.id}:`, error);
      result.calendar = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Skip expensive downstream steps if no new content was synced
    if (!hasNewContent) {
      console.log(`[cron] No new content for ${user.id}, skipping briefing generation`);
      result.memory = { success: true };
      result.consolidation = { success: true };
      result.overnightPush = { success: true, sent: 0, skipped: "No new content" };
      result.briefing = { success: true };
      result.push = { success: true, sent: 0 };
    } else {
      // Memory extraction (parallel system — failures don't block briefing)
      try {
        await processMemories(user.id);
        result.memory = { success: true };
      } catch (error) {
        console.error(`[cron] Memory processing failed for ${user.id}:`, error);
        result.memory = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }

      // Memory consolidation — discover connections + implications (failures don't block briefing)
      try {
        const runStartedAt = new Date();
        const consolidation = await consolidateMemories(user.id);
        const runCompletedAt = new Date();
        const digest = await createConsolidationDigest({
          userId: user.id,
          digestDate: today,
          timeZone,
          runStartedAt,
          runCompletedAt,
          counts: consolidation,
        });
        result.consolidation = {
          success: true,
          digestDate: digest.digestDate,
          summary: digest.summary,
          changeCount: digest.changeCount,
        };

        if (digest.changeCount > 0) {
          try {
            const overnightPush = await sendPushToUser(user.id, {
              title: "Overnight memory connections are ready",
              body: digest.summary.slice(0, 200),
              url: "/dashboard?tab=overnight",
              tag: "icyhot-overnight",
            });
            result.overnightPush = {
              success: true,
              sent: overnightPush.sent,
            };
          } catch (pushError) {
            console.error(`[cron] Overnight push failed for ${user.id}:`, pushError);
            result.overnightPush = {
              success: false,
              error: pushError instanceof Error ? pushError.message : "Unknown error",
            };
          }
        } else {
          result.overnightPush = {
            success: true,
            sent: 0,
            skipped: "No new overnight graph changes",
          };
        }
      } catch (error) {
        console.error(`[cron] Memory consolidation failed for ${user.id}:`, error);
        result.consolidation = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        result.overnightPush = {
          success: false,
          skipped: "Consolidation failed",
        };
      }

      // Invalidate stale briefing + suggestions so we regenerate with fresh synced data
      try {
        await db.delete(dailyBriefings).where(
          and(eq(dailyBriefings.userId, user.id), eq(dailyBriefings.briefingDate, today))
        );
        await db.delete(dailySuggestions).where(
          and(eq(dailySuggestions.userId, user.id), eq(dailySuggestions.suggestedDate, today))
        );
      } catch (e) {
        console.error(`[cron] Cache invalidation failed for ${user.id}:`, e);
      }

      // Generate daily briefing with fresh data
      try {
        const briefing = await generateDailyBriefing(user.id, {
          date: today,
          timeZone,
        });
        result.briefing = { success: true };

        // Send push notification with briefing summary
        if (briefing?.summary) {
          try {
            const pushResult = await sendPushToUser(user.id, {
              title: "Your morning briefing",
              body: briefing.summary.slice(0, 200),
              url: "/dashboard?tab=today",
              tag: "icyhot-briefing",
            });
            result.push = { success: true, sent: pushResult.sent };
          } catch (pushError) {
            console.error(`[cron] Push failed for ${user.id}:`, pushError);
            result.push = {
              success: false,
              error: pushError instanceof Error ? pushError.message : "Unknown error",
            };
          }
        } else {
          result.push = { success: true, sent: 0 };
        }
      } catch (error) {
        console.error(`[cron] Briefing generation failed for ${user.id}:`, error);
        result.briefing = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    // Provocations — run daily regardless of new content (they look back 3 days into existing data)
    try {
      const provResult = await generateProvocationsForUser(user.id, {
        date: today,
        timeZone,
      });
      result.provocations = { success: true, generated: provResult.generated };
    } catch (error) {
      console.error(`[cron] Provocation generation failed for ${user.id}:`, error);
      result.provocations = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Daily health score snapshot
    try {
      await snapshotHealthScoreForDate(user.id, { date: today, timeZone });
      result.healthSnapshot = { success: true };
    } catch (error) {
      console.error(`[cron] Health snapshot failed for ${user.id}:`, error);
      result.healthSnapshot = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Sunday: generate weekly retrospective
    if (isSunday) {
      result.retro = { success: false };
      try {
        const retro = await generateWeeklyRetro(user.id, { timeZone });
        result.retro = { success: true };

        if (retro?.weekSummary) {
          try {
            await sendPushToUser(user.id, {
              title: "Your weekly retro is ready",
              body: retro.weekSummary.slice(0, 200),
              url: "/dashboard?tab=week",
              tag: "icyhot-weekly-retro",
            });
          } catch (pushError) {
            console.error(`[cron] Retro push failed for ${user.id}:`, pushError);
          }
        }
      } catch (error) {
        console.error(`[cron] Weekly retro failed for ${user.id}:`, error);
        result.retro = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    results.push(result);
  }

  const allOk = results.every((r) => r.journal.success && r.calendar.success);

  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
