import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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
  providers: [Google],
  callbacks: {
    async signIn({ user }) {
      const allowed = process.env.ALLOWED_EMAIL;
      if (allowed && user.email !== allowed) {
        return false;
      }

      // Upsert user in our database
      const db = getDb();
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, user.email!));

      if (existing.length === 0) {
        await db.insert(users).values({
          name: user.name || "User",
          email: user.email!,
          image: user.image || null,
        });
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
