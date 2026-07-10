import { getAiConfig, type AiConfig } from "@/lib/settings";

/**
 * Minimal multi-provider text completion. Supports Anthropic (Messages API)
 * and OpenAI (Chat Completions). Used for the light "AI layer" — drafting a
 * site structure from a brief, etc.
 */

async function anthropic(cfg: AiConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content ?? []).map((b: { text?: string }) => b.text ?? "").join("").trim();
}

async function openai(cfg: AiConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

export async function aiComplete(system: string, user: string, maxTokens = 1500): Promise<string> {
  const cfg = await getAiConfig();
  if (!cfg) throw new Error("AI is not configured — add an API key in Settings.");
  return cfg.provider === "openai"
    ? openai(cfg, system, user, maxTokens)
    : anthropic(cfg, system, user, maxTokens);
}
