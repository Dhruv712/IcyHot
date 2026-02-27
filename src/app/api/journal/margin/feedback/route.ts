import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalNudgeFeedback, journalNudges } from "@/db/schema";
import { DOWNVOTE_REASONS, type MarginDownReason } from "@/lib/marginSpark";

interface FeedbackPayload {
  nudgeId?: string;
  feedback?: "up" | "down";
  reason?: MarginDownReason;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as FeedbackPayload;
  const nudgeId = typeof body.nudgeId === "string" ? body.nudgeId : "";
  const feedback = body.feedback;
  const reason = body.reason;

  if (!nudgeId || (feedback !== "up" && feedback !== "down")) {
    return NextResponse.json(
      { error: "nudgeId and valid feedback are required" },
      { status: 400 },
    );
  }

  if (feedback === "down") {
    if (!reason || !DOWNVOTE_REASONS.includes(reason)) {
      return NextResponse.json(
        { error: "reason is required for down feedback" },
        { status: 400 },
      );
    }
  }

  const [nudge] = await db
    .select({ id: journalNudges.id })
    .from(journalNudges)
    .where(
      and(
        eq(journalNudges.id, nudgeId),
        eq(journalNudges.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!nudge) {
    return NextResponse.json({ error: "Nudge not found" }, { status: 404 });
  }

  await db
    .insert(journalNudgeFeedback)
    .values({
      nudgeId,
      userId: session.user.id,
      feedback,
      reason: feedback === "down" ? reason : null,
    })
    .onConflictDoUpdate({
      target: [journalNudgeFeedback.nudgeId, journalNudgeFeedback.userId],
      set: {
        feedback,
        reason: feedback === "down" ? reason : null,
        createdAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
