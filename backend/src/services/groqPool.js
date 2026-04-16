/**
 * LLM provider — Cerebras Inference (OpenAI-compatible).
 * Free tier: 1M tokens/day, 60K tokens/min.
 *
 * Env vars:
 *   CEREBRAS_API_KEY — from https://cloud.cerebras.ai/
 */

import OpenAI from "openai";

let client = null;

export function initGroqPool() {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) {
    console.warn("[LLM] No CEREBRAS_API_KEY set — AI features disabled");
    return 0;
  }

  client = new OpenAI({
    apiKey: key,
    baseURL: "https://api.cerebras.ai/v1",
  });

  console.log("[LLM] Cerebras provider initialized");
  return 1;
}

/**
 * Execute a chat completion via Cerebras.
 */
export async function groqChatWithRetry(params) {
  if (!client) throw new Error("No LLM provider configured (set CEREBRAS_API_KEY)");

  // Map Groq model names to Cerebras equivalents
  const model = mapModel(params.model);
  return client.chat.completions.create({ ...params, model });
}

function mapModel(requestedModel) {
  const map = {
    "llama-3.3-70b-versatile": "llama-3.3-70b",
    "llama-3.1-8b-instant": "llama-3.3-70b",
    "llama3.1-8b": "llama-3.3-70b",
  };
  return map[requestedModel] || requestedModel;
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
    configured: !!client,
  };
}
