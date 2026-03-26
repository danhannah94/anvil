import { describe, it, expect, beforeAll } from 'vitest';
import { Embedder } from '../src/embedder.js';

describe('Embedder', () => {
  const embedder = new Embedder();

  beforeAll(async () => {
    await embedder.init();
  }, 120_000);

  it('initializes without error', () => {
    expect(embedder.getModelName()).toBe('Xenova/all-MiniLM-L6-v2');
    expect(embedder.getDimensions()).toBe(384);
  });

  it('embedChunks returns 384-dim Float32Arrays', async () => {
    const results = await embedder.embedChunks(['Hello world']);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0].length).toBe(384);
  });

  it('embedQuery returns a single 384-dim Float32Array', async () => {
    const result = await embedder.embedQuery('test query');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
  });

  it('batch processing works', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `Text number ${i}`);
    const results = await embedder.embedChunks(texts);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(384);
    }
  });

  it('different texts produce different embeddings', async () => {
    const [a, b] = await embedder.embedChunks(['cats are great', 'quantum physics theory']);
    let same = true;
    for (let i = 0; i < 384; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-6) { same = false; break; }
    }
    expect(same).toBe(false);
  });

  it('same text produces same embedding (deterministic)', async () => {
    const [a] = await embedder.embedChunks(['deterministic test']);
    const [b] = await embedder.embedChunks(['deterministic test']);
    for (let i = 0; i < 384; i++) {
      expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6);
    }
  });
});
