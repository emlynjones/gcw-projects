/* Seeds the GCW service/price list. Upserts by name — safe to re-run.
   All prices ex-VAT. "From £X" items seeded at the minimum. */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const services = [
  // Websites (from-prices)
  ["1-page website", 295, "one-off", "Websites", "From £295 — single page site"],
  ["Standard business website", 795, "one-off", "Websites", "From £795 — >100 pages/products attracts an additional charge"],
  ["Ecommerce website", 1995, "one-off", "Websites", "From £1,995 — >100 products attracts an additional charge"],
  ["Bespoke website", 3495, "one-off", "Websites", "From £3,495"],
  // Care plans
  ["Care Plan — Quarterly Updates", 9.99, "month", "Care Plans", null],
  ["Care Plan — Essentials", 29, "month", "Care Plans", null],
  ["Care Plan — Booster", 49, "month", "Care Plans", null],
  ["Care Plan — Growth", 75, "month", "Care Plans", null],
  ["Care Plan — Elevator", 149, "month", "Care Plans", null],
  ["Website MOT", 100, "one-off", "Care Plans", null],
  // Audits
  ["Website Audit", 195, "one-off", "Audits", null],
  ["SEO Audit", 245, "one-off", "SEO", "On-page + technical audit with written report"],
  ["Social Media Audit", 195, "one-off", "Audits", null],
  // SEO
  ["Keyword Research", 225, "one-off", "SEO", null],
  ["SEO Essentials", 495, "one-off", "SEO", "Audit + keyword research + GSC/GA setup and more"],
  ["SEO Growth", 975, "one-off", "SEO", "Everything in Essentials plus on-page optimisation"],
  ["SEO Monthly Care Plan", 495, "month", "SEO", "Starts with Growth, then monthly monitoring/reporting/optimisation"],
  // Training
  ["WordPress/Social Media Training (standard)", 350, "session", "Training", "Up to 5 people per session"],
  ["WordPress/Social Media Training (existing client)", 195, "session", "Training", "Up to 5 people per session"],
  // Hosting
  ["Hosting — Standard", 95, "year", "Hosting", null],
  ["Hosting — Pro", 175, "year", "Hosting", null],
  ["Hosting — Standalone", 250, "year", "Hosting", null],
  ["Hosting — Standalone+", 350, "year", "Hosting", null],
  ["Hosting add-on — extra 1GB (Standard)", 40, "year", "Hosting", null],
  ["Hosting add-on — extra 1GB (Pro)", 70, "year", "Hosting", null],
  // Office 365
  ["Office 365 Essentials licence (per user)", 6, "month", "Office 365", null],
  ["Office 365 Desktop licence (per user)", 15, "month", "Office 365", null],
  ["Office 365 setup fee", 60, "one-off", "Office 365", null],
  ["Office 365 migration fee", 60, "one-off", "Office 365", null],
  // Consultancy
  ["Digital marketing consultancy — day", 400, "day", "Consultancy", null],
  ["Digital marketing consultancy — half day", 200, "half-day", "Consultancy", null],
  // Social media management
  ["Social Media — Whisper (1 platform)", 290, "month", "Social Media", null],
  ["Social Media — Cheer (2 platforms)", 650, "month", "Social Media", null],
  ["Social Media — Shout (3+ platforms)", 910, "month", "Social Media", null],
  ["Social Media Strategy", 245, "one-off", "Social Media", null],
  // Ad hoc
  ["Ad hoc — general website work", 45, "hour", "Ad Hoc", null],
  ["Ad hoc — technical website work", 60, "hour", "Ad Hoc", "Emlyn/Dylan only"],
  ["Ad hoc — care plan client rate", 35, "hour", "Ad Hoc", "Applies to any work type for care plan clients"],
  ["Day rate — non-technical", 330, "day", "Ad Hoc", null],
  ["Day rate — technical", 450, "day", "Ad Hoc", null],
];

async function main() {
  let order = 0;
  for (const [name, price, unit, category, description] of services) {
    // Create-only: never overwrite prices/details edited in the UI
    await prisma.service.upsert({
      where: { name },
      update: {},
      create: { name, price, unit, category, description, sortOrder: order },
    });
    order += 10;
  }
  console.log(`Seeded ${services.length} services.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
