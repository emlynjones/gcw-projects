import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.GCW_O365_CLIENT_ID,
      clientSecret: process.env.GCW_O365_CLIENT_SECRET,
      issuer: process.env.GCW_O365_TENANT_ID
        ? `https://login.microsoftonline.com/${process.env.GCW_O365_TENANT_ID}/v2.0`
        : undefined,
    }),
    Credentials({
      name: "Admin login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === "microsoft-entra-id") {
        const microsoftProfile = profile as
          | { email?: string; preferred_username?: string }
          | undefined;
        const email = (
          user.email ??
          microsoftProfile?.preferred_username ??
          microsoftProfile?.email ??
          ""
        )
          .trim()
          .toLowerCase();
        if (!email) return false;

        const allowed = new Set(
          (process.env.GCW_ADMIN_ALLOWED ?? "")
            .split(",")
            .map((address) => address.trim().toLowerCase())
            .filter(Boolean),
        );
        if (!allowed.has(email)) return false;

        await prisma.user.upsert({
          where: { email },
          update: { name: user.name ?? email },
          create: { email, name: user.name ?? email, role: "staff", provider: "entra" },
        });
      }
      return true;
    },
  },
});
