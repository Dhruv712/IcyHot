import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { users, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.events.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Upsert user in our database
      const db = getDb();
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, user.email!));

      let dbUserId: string;
      if (existing.length === 0) {
        const [newUser] = await db
          .insert(users)
          .values({
            name: user.name || "User",
            email: user.email!,
            image: user.image || null,
          })
          .returning({ id: users.id });
        dbUserId = newUser.id;
      } else {
        dbUserId = existing[0].id;
      }

      // Store OAuth tokens for Google API access (calendar etc.)
      if (account && account.provider === "google") {
        const existingAccount = await db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, dbUserId),
              eq(accounts.provider, "google")
            )
          );

        if (existingAccount.length === 0) {
          await db.insert(accounts).values({
            userId: dbUserId,
            provider: account.provider,
            providerAccountId: account.providerAccountId!,
            accessToken: account.access_token ?? null,
            refreshToken: account.refresh_token ?? null,
            expiresAt: account.expires_at ?? null,
            tokenType: account.token_type ?? null,
            scope: account.scope ?? null,
          });
        } else {
          await db
            .update(accounts)
            .set({
              accessToken: account.access_token ?? null,
              refreshToken: account.refresh_token ?? existingAccount[0].refreshToken,
              expiresAt: account.expires_at ?? null,
              tokenType: account.token_type ?? null,
              scope: account.scope ?? null,
            })
            .where(eq(accounts.id, existingAccount[0].id));
        }
      }

      return true;
    },
    async session({ session }) {
      // Attach our DB user ID to the session
      if (session.user?.email) {
        const db = getDb();
        const [dbUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, session.user.email));
        if (dbUser) {
          session.user.id = dbUser.id;
        }
      }
      return session;
    },
  },
});
