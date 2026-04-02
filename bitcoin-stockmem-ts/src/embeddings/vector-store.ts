/**
 * Lightweight cosine similarity search over embeddings.
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // assumes L2-normalised
}

export function topKSimilar(
  query: number[],
  corpus: number[][],
  corpusIds: number[],
  k = 10
): Array<{ id: number; score: number }> {
  if (corpus.length === 0) return [];

  const scored = corpus.map((vec, i) => ({
    id: corpusIds[i],
    score: cosineSimilarity(query, vec),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
