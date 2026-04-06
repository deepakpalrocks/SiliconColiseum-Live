/**
 * Groq API key pool - rotates through multiple keys to avoid rate limits.
 * Set GROQ_API_KEYS as comma-separated keys in .env
 * Falls back to single GROQ_API_KEY if pool not set.
 */

import OpenAI from "openai";

let keys = [];
let currentIndex = 0;

export function initGroqPool() {
  const poolStr = process.env.GROQ_API_KEYS;
  const singleKey = process.env.GROQ_API_KEY;

  if (poolStr) {
    keys = poolStr.split(",").map((k) => k.trim()).filter(Boolean);
  }
  if (singleKey && !keys.includes(singleKey)) {
    keys.push(singleKey);
  }

  console.log(`[GROQ] Initialized pool with ${keys.length} API key(s)`);
  return keys.length;
}

/**
 * Get the next API key (round-robin)
 */
export function getNextKey() {
  if (!keys.length) return null;
  const key = keys[currentIndex];
  currentIndex = (currentIndex + 1) % keys.length;
  return key;
}

/**
 * Get an OpenAI-compatible client with the next available key
 */
export function getGroqClient() {
  const key = getNextKey();
  if (!key) throw new Error("No Groq API keys available");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

/**
 * Get total number of keys in the pool
 */
export function getPoolSize() {
  return keys.length;
}
