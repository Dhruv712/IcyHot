import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Get a valid Google access token for a user, refreshing if needed.
 * Returns null if no tokens stored or refresh fails.
 */
export async function getGoogleAccessToken(
  userId: string
): Promise<string | null> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.provider, "google"))
    );

  if (!account?.refreshToken) return null;

  // Check if token is still valid (with 5-minute buffer)
  const now = Math.floor(Date.now() / 1000);
  if (account.accessToken && account.expiresAt && account.expiresAt > now + 300) {
    return account.accessToken;
  }

  // Refresh the token
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID!,
        client_secret: process.env.AUTH_GOOGLE_SECRET!,
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
      }),
    });

    if (!response.ok) {
      console.error("Token refresh failed:", response.status);
      return null;
    }

    const tokens = await response.json();
    if (!tokens.access_token) return null;

    // Update stored tokens
    await db
      .update(accounts)
      .set({
        accessToken: tokens.access_token,
        expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      })
      .where(eq(accounts.id, account.id));

    return tokens.access_token;
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}

/**
 * Check if a user has Google Calendar connected (has refresh token + calendar scope).
 */
export async function hasCalendarAccess(userId: string): Promise<boolean> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.provider, "google"))
    );

  if (!account?.refreshToken || !account.scope) return false;
  return account.scope.includes("calendar");
}
