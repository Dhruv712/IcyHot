import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalOpenLoops, contacts } from "@/db/schema";
import { eq, and, desc, or, isNull, lte, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const showResolved = req.nextUrl.searchParams.get("resolved") === "true";

  const conditions = [eq(journalOpenLoops.userId, session.user.id)];
  if (!showResolved) {
    conditions.push(eq(journalOpenLoops.resolved, false));
    // Hide snoozed loops (snoozed_until in the future)
    conditions.push(
      or(
        isNull(journalOpenLoops.snoozedUntil),
        lte(journalOpenLoops.snoozedUntil, sql`CURRENT_DATE`)
      )!
    );
  }

  const results = await db
    .select({
      id: journalOpenLoops.id,
      entryDate: journalOpenLoops.entryDate,
      content: journalOpenLoops.content,
      contactId: journalOpenLoops.contactId,
      contactName: contacts.name,
      resolved: journalOpenLoops.resolved,
      resolvedAt: journalOpenLoops.resolvedAt,
      snoozedUntil: journalOpenLoops.snoozedUntil,
      createdAt: journalOpenLoops.createdAt,
    })
    .from(journalOpenLoops)
    .leftJoin(contacts, eq(journalOpenLoops.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(journalOpenLoops.entryDate))
    .limit(100);

  return NextResponse.json(results);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, resolved, snoozedUntil } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Verify ownership
  const [loop] = await db
    .select()
    .from(journalOpenLoops)
    .where(
      and(
        eq(journalOpenLoops.id, id),
        eq(journalOpenLoops.userId, session.user.id)
      )
    );

  if (!loop) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Build update payload
  const updates: Record<string, unknown> = {};

  if (resolved !== undefined) {
    updates.resolved = !!resolved;
    updates.resolvedAt = resolved ? new Date() : null;
  }

  if (snoozedUntil !== undefined) {
    updates.snoozedUntil = snoozedUntil; // string date or null to clear
  }

  await db
    .update(journalOpenLoops)
    .set(updates)
    .where(eq(journalOpenLoops.id, id));

  return NextResponse.json({ success: true });
}
