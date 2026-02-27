import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "@/lib/timezone";

export async function getUserTimeZone(userId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ timeZone: users.timeZone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return normalizeTimeZone(row?.timeZone ?? DEFAULT_TIME_ZONE);
  } catch (error) {
    console.warn("[timezone] Falling back to UTC (users.time_zone unavailable):", error);
    return DEFAULT_TIME_ZONE;
  }
}
