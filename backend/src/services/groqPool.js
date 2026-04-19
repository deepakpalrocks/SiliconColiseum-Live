/**
 * LLM provider — DeepSeek V3 (OpenAI-compatible).
 *
 * Env vars:
 *   DEEPSEEK_API_KEY — from https://platform.deepseek.com/
 */

import OpenAI from "openai";

let client = null;
const MODEL = "deepseek-chat"; // DeepSeek V3 (671B MoE)

export async function initGroqPool() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    console.warn("[LLM] No DEEPSEEK_API_KEY set — AI features disabled");
    return 0;
  }

  client = new OpenAI({
    apiKey: key,
    baseURL: "https://api.deepseek.com",
  });

  console.log(`[LLM] DeepSeek initialized — using model: ${MODEL}`);
  return 1;
}

/**
 * Execute a chat completion via DeepSeek.
 */
export async function groqChatWithRetry(params) {
  if (!client) throw new Error("No LLM provider configured (set DEEPSEEK_API_KEY)");

  return client.chat.completions.create({ ...params, model: MODEL });
}

export function getResolvedModel() {
  return MODEL;
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
    provider: "deepseek",
    model: MODEL,
    configured: !!client,
  };
}
