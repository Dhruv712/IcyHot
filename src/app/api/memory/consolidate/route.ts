import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { consolidateMemories } from "@/lib/memory/consolidate";

export const maxDuration = 300; // Vercel Hobby with fluid compute allows up to 300s

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await consolidateMemories(session.user.id, {
    timeoutMs: 90_000,
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
}
