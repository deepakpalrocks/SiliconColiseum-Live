/**
 * LLM provider — Cerebras Inference (OpenAI-compatible).
 * Free tier: 1M tokens/day, 60K tokens/min.
 *
 * Env vars:
 *   CEREBRAS_API_KEY — from https://cloud.cerebras.ai/
 */

import OpenAI from "openai";

let client = null;
let availableModels = [];
let resolvedModel = "llama3.1-8b"; // safe fallback

// Preferred models in order (biggest/smartest first)
const MODEL_PREFERENCE = ["llama3.1-70b", "gpt-oss-120b", "llama3.1-8b"];

export async function initGroqPool() {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) {
    console.warn("[LLM] No CEREBRAS_API_KEY set — AI features disabled");
    return 0;
  }

  client = new OpenAI({
    apiKey: key,
    baseURL: "https://api.cerebras.ai/v1",
  });

  // Discover available models and pick the best one
  try {
    const list = await client.models.list();
    availableModels = list.data.map((m) => m.id);
    console.log(`[LLM] Cerebras models available: ${availableModels.join(", ")}`);

    for (const preferred of MODEL_PREFERENCE) {
      if (availableModels.includes(preferred)) {
        resolvedModel = preferred;
        break;
      }
    }
  } catch (err) {
    console.warn(`[LLM] Could not list models (${err.message}), defaulting to ${resolvedModel}`);
  }

  console.log(`[LLM] Cerebras initialized — using model: ${resolvedModel}`);
  return 1;
}

/**
 * Execute a chat completion via Cerebras.
 */
export async function groqChatWithRetry(params) {
  if (!client) throw new Error("No LLM provider configured (set CEREBRAS_API_KEY)");

  // Always use the best available model regardless of what's requested
  const model = resolvedModel;
  return client.chat.completions.create({ ...params, model });
}

export function getResolvedModel() {
  return resolvedModel;
}

export function getGroqClient() {
  if (!client) throw new Error("No LLM provider configured");
  return client;
}

export function getPoolSize() {
  return client ? 1 : 0;
}

export function getPoolStatus() {
  return {
    provider: "cerebras",
    model: resolvedModel,
    availableModels,
    configured: !!client,
  };
}
