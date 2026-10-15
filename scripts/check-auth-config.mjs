const required = [
  "AUTH_SECRET",
  "AUTH_URL",
  "GCW_O365_TENANT_ID",
  "GCW_O365_CLIENT_ID",
  "GCW_O365_CLIENT_SECRET",
  "GCW_ADMIN_ALLOWED",
];

const errors = [];

for (const name of required) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || /^<.*>$/.test(value) || /^(changeme|your-)/i.test(value)) {
    errors.push(`${name} is missing or still contains a placeholder`);
  }
}

const baseUrl = process.env.AUTH_URL?.trim() ?? "";
try {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    errors.push("AUTH_URL must use HTTPS (except on localhost)");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    errors.push("AUTH_URL must be an origin without a path, query, or fragment");
  }
} catch {
  errors.push("AUTH_URL must be a valid absolute URL");
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const name of ["GCW_O365_TENANT_ID", "GCW_O365_CLIENT_ID"]) {
  const value = process.env[name]?.trim() ?? "";
  if (value && !uuid.test(value)) errors.push(`${name} must be a UUID`);
}

const addresses = (process.env.GCW_ADMIN_ALLOWED ?? "")
  .split(",")
  .map((address) => address.trim())
  .filter(Boolean);
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (addresses.some((address) => !email.test(address))) {
  errors.push("GCW_ADMIN_ALLOWED must be a comma-separated list of email addresses");
}

if (errors.length) {
  console.error("Microsoft authentication configuration is invalid:");
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Microsoft authentication configuration is valid (${addresses.length} allowed account(s)).`);
