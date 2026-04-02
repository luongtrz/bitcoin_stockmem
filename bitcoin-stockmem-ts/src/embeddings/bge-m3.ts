/**
 * BGE-M3 embedding bridge: calls Python subprocess for encoding.
 *
 * Uses one-shot mode with stdin pipe (no shell escaping issues).
 * Caches the model in a persistent process for subsequent calls.
 */

import { spawn, execFileSync, type ChildProcess } from "child_process";
import path from "path";
import { PYTHON_EMBED_SCRIPT } from "../config";

let serverProcess: ChildProcess | null = null;
let serverReady = false;
let responseQueue: Array<(val: number[][]) => void> = [];
let stdoutBuffer = "";

// ---------------------------------------------------------------------------
// Persistent server mode
// ---------------------------------------------------------------------------

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const venvPython = path.join(process.cwd(), ".venv", "bin", "python3");
    const pythonCmd = require("fs").existsSync(venvPython) ? venvPython : "python3";

    serverProcess = spawn(pythonCmd, [PYTHON_EMBED_SCRIPT, "--serve"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    const timeout = setTimeout(() => {
      if (!serverReady) {
        console.warn("Embedding server timeout, will use one-shot mode");
        reject(new Error("timeout"));
      }
    }, 120_000);

    serverProcess.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed === "READY") {
          serverReady = true;
          clearTimeout(timeout);
          console.log("Embedding server ready");
          resolve();
          continue;
        }

        // Response for a pending request
        const cb = responseQueue.shift();
        if (cb) {
          try {
            const data = JSON.parse(trimmed);
            cb(data.error ? [] : data);
          } catch {
            cb([]);
          }
        }
      }
    });

    serverProcess.on("exit", () => {
      serverProcess = null;
      serverReady = false;
    });
  });
}

async function ensureServer(): Promise<boolean> {
  if (serverReady && serverProcess) return true;
  try {
    await startServer();
    return true;
  } catch {
    return false;
  }
}

function sendToServer(texts: string[]): Promise<number[][]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 60_000);

    responseQueue.push((val) => {
      clearTimeout(timer);
      resolve(val);
    });

    serverProcess!.stdin!.write(JSON.stringify(texts) + "\n");
  });
}

// ---------------------------------------------------------------------------
// One-shot mode (fallback) — uses stdin pipe, no shell escaping
// ---------------------------------------------------------------------------

function encodeOneShot(texts: string[]): number[][] {
  try {
    const venvPython = path.join(process.cwd(), ".venv", "bin", "python3");
    const pythonCmd = require("fs").existsSync(venvPython) ? venvPython : "python3";

    const result = execFileSync(pythonCmd, [PYTHON_EMBED_SCRIPT], {
      input: JSON.stringify(texts),
      timeout: 120_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(result.toString());
  } catch (e: any) {
    console.error("One-shot embedding failed:", e.message?.slice(0, 200));
    // Return zero vectors as fallback
    return texts.map(() => new Array(384).fill(0));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function encode(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Try persistent server first
  const ready = await ensureServer();
  if (ready) {
    return sendToServer(texts);
  }

  // Fallback to one-shot
  return encodeOneShot(texts);
}

export async function encodeSingle(text: string): Promise<number[]> {
  const result = await encode([text]);
  return result[0] ?? new Array(384).fill(0);
}

export function embeddingToBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export function bufferToEmbedding(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}

export function shutdown(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverReady = false;
  }
}
