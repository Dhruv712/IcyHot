import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(groups)
    .where(eq(groups.userId, session.user.id!));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, color } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [group] = await db
    .insert(groups)
    .values({
      userId: session.user.id!,
      name,
      color: color || null,
    })
    .returning();

  return NextResponse.json(group, { status: 201 });
}
