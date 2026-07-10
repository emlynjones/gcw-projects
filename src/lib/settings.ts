import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

/**
 * Key/value settings. AI credentials live here; the API key is stored
 * encrypted (AI_API_KEY_ENC) and never returned to the client in the clear.
 */

export const AI_PROVIDER = "AI_PROVIDER"; // "anthropic" | "openai"
export const AI_MODEL = "AI_MODEL";
export const AI_API_KEY_ENC = "AI_API_KEY_ENC";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

export type AiConfig = {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
};

export const DEFAULT_AI_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o",
};

/** Full AI config incl. decrypted key — server-only. Null if not configured. */
export async function getAiConfig(): Promise<AiConfig | null> {
  const [provider, model, enc] = await Promise.all([
    getSetting(AI_PROVIDER),
    getSetting(AI_MODEL),
    getSetting(AI_API_KEY_ENC),
  ]);
  if (!provider || !enc) return null;
  const p = provider === "openai" ? "openai" : "anthropic";
  let apiKey: string;
  try {
    apiKey = decryptSecret(enc);
  } catch {
    return null;
  }
  return { provider: p, model: model || DEFAULT_AI_MODEL[p], apiKey };
}

/** Safe status for the UI — whether a key is set, provider and model, no secret. */
export async function getAiStatus(): Promise<{ configured: boolean; provider: string | null; model: string | null }> {
  const [provider, model, enc] = await Promise.all([
    getSetting(AI_PROVIDER),
    getSetting(AI_MODEL),
    getSetting(AI_API_KEY_ENC),
  ]);
  return { configured: !!enc, provider, model };
}

export async function saveAiSettings(provider: string, model: string, apiKey: string | null): Promise<void> {
  const p = provider === "openai" ? "openai" : "anthropic";
  await setSetting(AI_PROVIDER, p);
  await setSetting(AI_MODEL, model || DEFAULT_AI_MODEL[p]);
  if (apiKey) await setSetting(AI_API_KEY_ENC, encryptSecret(apiKey));
}
