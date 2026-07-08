import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe config (no Prisma imports) — shared by middleware and the full auth setup.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "staff";
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = (token.role as string) ?? "staff";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
