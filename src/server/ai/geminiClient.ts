import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

/**
 * Returns one shared Gemini SDK client (created on first use from GEMINI_API_KEY).
 * Reads process.env directly so a problem with an unrelated variable can never break AI calls.
 */
export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}
