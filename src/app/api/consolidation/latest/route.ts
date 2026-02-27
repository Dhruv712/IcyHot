import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getConsolidationDigestByDate,
  getLatestConsolidationDigest,
} from "@/lib/memory/consolidationDigest";
import { getUserTimeZone } from "@/lib/userTimeZone";
import { getDateStringInTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const timeZone = await getUserTimeZone(userId);
  const requestedDate = request.nextUrl.searchParams.get("date");

  const digest =
    requestedDate && isYmd(requestedDate)
      ? await getConsolidationDigestByDate(userId, requestedDate)
      : await getLatestConsolidationDigest(userId);

  return NextResponse.json({
    digest,
    requestedDate:
      requestedDate && isYmd(requestedDate)
        ? requestedDate
        : getDateStringInTimeZone(new Date(), timeZone),
    timeZone,
  });
}
