import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seeds the throwaway e2e database with deterministic fixtures. Reads
 * DATABASE_URL from the environment (set by the provisioner / Playwright
 * webServer), so it always targets the test DB — never live data.
 */
export async function seed() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash("test-password-123", 10);
    await prisma.user.upsert({
      where: { email: "test@example.com" },
      update: { passwordHash, role: "admin" },
      create: {
        email: "test@example.com",
        name: "Test Admin",
        role: "admin",
        provider: "credentials",
        passwordHash,
      },
    });

    // Minimal price list so "standard services" (hosting + domain) resolve by name.
    const services = [
      { name: "Standard hosting", unit: "year", price: 120, category: "Care Plans" },
      { name: "Domain name", unit: "year", price: 15, category: "Care Plans" },
      { name: "SEO Audit", unit: "one-off", price: 245, category: "SEO" },
    ];
    for (const s of services) {
      await prisma.service.upsert({ where: { name: s.name }, update: s, create: s });
    }

    // A client that ALREADY has a project — the ad-hoc-creation regression case.
    const acme = await prisma.client.create({
      data: { name: "Acme Ltd", email: "acme@example.com", contactName: "Wile E." },
    });
    await prisma.project.create({
      data: { title: "Acme Website", clientId: acme.id, type: "PROJECT", stage: "ONBOARDING", totalValue: 3000 },
    });

    // A fresh client with no projects.
    await prisma.client.create({ data: { name: "Beta Co", email: "beta@example.com" } });
  } finally {
    await prisma.$disconnect();
  }
}
