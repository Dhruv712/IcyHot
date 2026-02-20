import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contactId = request.nextUrl.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId query parameter is required" },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      sourceDate: memories.sourceDate,
      source: memories.source,
      strength: memories.strength,
      contactIds: memories.contactIds,
    })
    .from(memories)
    .where(
      sql`${memories.userId} = ${session.user.id} AND ${memories.contactIds} LIKE ${"%" + contactId + "%"}`
    )
    .orderBy(desc(memories.sourceDate));

  const parsed = rows.map((row) => ({
    ...row,
    contactIds: row.contactIds ? JSON.parse(row.contactIds) : [],
  }));

  return NextResponse.json({ memories: parsed });
}
