import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

export async function encode(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ext = await getExtractor();
  const output = await ext(texts, { pooling: "mean", normalize: true });
  const dims = output.dims; // [batch, seq_or_1, embedding_dim]
  const embDim = dims[dims.length - 1];
  const data: number[] = Array.from(output.data as Float32Array);

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(data.slice(i * embDim, (i + 1) * embDim));
  }
  return results;
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
  extractor = null;
}
