/**
 * Gemini 2.5 Flash API wrapper with rate limiting and structured JSON output.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  GEMINI_API_KEY, GEMINI_MODEL, GEMINI_RPM,
  GEMINI_RETRY_DELAY, GEMINI_MAX_RETRIES, GEMINI_TEMPERATURE,
} from "../config";

export class GeminiClient {
  private model;
  private minInterval: number;
  private lastRequestTime = 0;

  constructor(apiKey?: string) {
    const key = apiKey || GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");

    const genAI = new GoogleGenerativeAI(key);
    this.model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    this.minInterval = 60_000 / GEMINI_RPM; // ms
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await sleep(this.minInterval - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  async generate(prompt: string, jsonMode = true): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      await this.waitForRateLimit();
      try {
        const result = await this.model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: GEMINI_TEMPERATURE,
            ...(jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        });
        const text = result.response.text().trim();
        return text;
      } catch (e: any) {
        lastError = e;
        const wait = GEMINI_RETRY_DELAY * attempt * 1000;
        console.warn(
          `Gemini attempt ${attempt}/${GEMINI_MAX_RETRIES} failed: ${e.message}. Retrying in ${wait / 1000}s`
        );
        await sleep(wait);
      }
    }
    throw new Error(`Gemini failed after ${GEMINI_MAX_RETRIES} attempts: ${lastError?.message}`);
  }

  async generateJson(prompt: string): Promise<any> {
    const text = await this.generate(prompt, true);
    return parseJsonResponse(text);
  }
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

export function parseJsonResponse(text: string): any {
  // Direct parse
  try { return JSON.parse(text); } catch {}

  // Markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?(.*?)```/s);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // Find first { ... } or [ ... ]
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ]) {
    const start = text.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }

  throw new Error(`Could not parse JSON from response: ${text.slice(0, 200)}...`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
