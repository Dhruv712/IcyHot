import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { normalizeTimeZone } from "@/lib/timezone";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const requested = typeof body?.timeZone === "string" ? body.timeZone : "";
  const timeZone = normalizeTimeZone(requested);

  if (!requested || timeZone !== requested) {
    return NextResponse.json({ error: "Invalid timeZone" }, { status: 400 });
  }

  await db
    .update(users)
    .set({ timeZone })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ ok: true, timeZone });
}
