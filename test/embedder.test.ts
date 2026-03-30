import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  LocalEmbedder,
  OpenAIEmbedder,
  createEmbedder,
} from '../src/embedder.js';

// --- LocalEmbedder tests (existing, adapted) ---

describe('LocalEmbedder', () => {
  const embedder = new LocalEmbedder();

  beforeAll(async () => {
    await embedder.init();
  }, 120_000);

  it('initializes without error', () => {
    expect(embedder.modelName).toBe('Xenova/all-MiniLM-L6-v2');
    expect(embedder.dimensions).toBe(384);
  });

  it('embedBatch returns 384-dim Float32Arrays', async () => {
    const results = await embedder.embedBatch(['Hello world']);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0].length).toBe(384);
  });

  it('embed returns a single 384-dim Float32Array', async () => {
    const result = await embedder.embed('test query');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
  });

  it('batch processing works', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `Text number ${i}`);
    const results = await embedder.embedBatch(texts);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(384);
    }
  });

  it('different texts produce different embeddings', async () => {
    const results = await embedder.embedBatch(['cats are great', 'quantum physics theory']);
    const [a, b] = results;
    let same = true;
    for (let i = 0; i < 384; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-6) { same = false; break; }
    }
    expect(same).toBe(false);
  });

  it('same text produces same embedding (deterministic)', async () => {
    const [a] = await embedder.embedBatch(['deterministic test']);
    const [b] = await embedder.embedBatch(['deterministic test']);
    for (let i = 0; i < 384; i++) {
      expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6);
    }
  });
});

// --- createEmbedder factory tests ---

describe('createEmbedder', () => {
  it('defaults to LocalEmbedder', () => {
    const embedder = createEmbedder();
    expect(embedder).toBeInstanceOf(LocalEmbedder);
    expect(embedder.dimensions).toBe(384);
    expect(embedder.modelName).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('explicit local returns LocalEmbedder', () => {
    const embedder = createEmbedder({ provider: 'local' });
    expect(embedder).toBeInstanceOf(LocalEmbedder);
  });

  it('explicit openai returns OpenAIEmbedder', () => {
    const embedder = createEmbedder({ provider: 'openai', apiKey: 'test-key' });
    expect(embedder).toBeInstanceOf(OpenAIEmbedder);
    expect(embedder.dimensions).toBe(1536);
    expect(embedder.modelName).toBe('text-embedding-3-small');
  });

  it('openai with custom model', () => {
    const embedder = createEmbedder({ provider: 'openai', apiKey: 'test-key', model: 'text-embedding-3-large' });
    expect(embedder).toBeInstanceOf(OpenAIEmbedder);
    expect(embedder.modelName).toBe('text-embedding-3-large');
  });

  it('local with custom model prepends Xenova/', () => {
    const embedder = createEmbedder({ provider: 'local', model: 'custom-model' });
    expect(embedder).toBeInstanceOf(LocalEmbedder);
    expect(embedder.modelName).toBe('Xenova/custom-model');
  });
});

// --- OpenAIEmbedder tests ---

describe('OpenAIEmbedder', () => {
  it('throws clear error when no API key', () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new OpenAIEmbedder()).toThrow(
        'OpenAI API key required. Set embedding.apiKey or OPENAI_API_KEY env var.'
      );
    } finally {
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    }
  });

  it('reads API key from env var', () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-test-key';
    try {
      const embedder = new OpenAIEmbedder();
      expect(embedder.dimensions).toBe(1536);
      expect(embedder.modelName).toBe('text-embedding-3-small');
    } finally {
      if (origKey !== undefined) {
        process.env.OPENAI_API_KEY = origKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    }
  });

  it('init is a no-op', async () => {
    const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });
    await expect(embedder.init()).resolves.toBeUndefined();
  });

  describe('with mocked OpenAI client', () => {
    function makeEmbedding(dims: number): number[] {
      return Array.from({ length: dims }, (_, i) => i * 0.001);
    }

    it('embed returns Float32Array of correct dimension', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });

      (embedder as any).client = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: makeEmbedding(1536), index: 0 }],
          }),
        },
      };

      const result = await embedder.embed('hello');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(1536);
    });

    it('embedBatch returns correct number of results', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });

      (embedder as any).client = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [
              { embedding: makeEmbedding(1536), index: 0 },
              { embedding: makeEmbedding(1536), index: 1 },
              { embedding: makeEmbedding(1536), index: 2 },
            ],
          }),
        },
      };

      const results = await embedder.embedBatch(['a', 'b', 'c']);
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r).toBeInstanceOf(Float32Array);
        expect(r.length).toBe(1536);
      }
    });

    it('embedBatch chunks large batches into multiple requests', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });
      const createMock = vi.fn();

      createMock.mockResolvedValueOnce({
        data: Array.from({ length: 2048 }, (_, i) => ({
          embedding: makeEmbedding(1536),
          index: i,
        })),
      });
      createMock.mockResolvedValueOnce({
        data: [{ embedding: makeEmbedding(1536), index: 0 }],
      });

      (embedder as any).client = { embeddings: { create: createMock } };

      const texts = Array.from({ length: 2049 }, (_, i) => `text ${i}`);
      const results = await embedder.embedBatch(texts);

      expect(createMock).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2049);
      expect(createMock.mock.calls[0][0].input).toHaveLength(2048);
      expect(createMock.mock.calls[1][0].input).toHaveLength(1);
    });

    it('retries on 429 then succeeds', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });
      const createMock = vi.fn();

      const rateLimitError = new Error('Rate limited');
      (rateLimitError as any).status = 429;
      createMock.mockRejectedValueOnce(rateLimitError);

      createMock.mockResolvedValueOnce({
        data: [{ embedding: makeEmbedding(1536), index: 0 }],
      });

      (embedder as any).client = { embeddings: { create: createMock } };

      const result = await embedder.embed('hello');
      expect(createMock).toHaveBeenCalledTimes(2);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(1536);
    });

    it('retries on 500 then succeeds', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });
      const createMock = vi.fn();

      const serverError = new Error('Internal server error');
      (serverError as any).status = 500;
      createMock.mockRejectedValueOnce(serverError);

      createMock.mockResolvedValueOnce({
        data: [{ embedding: makeEmbedding(1536), index: 0 }],
      });

      (embedder as any).client = { embeddings: { create: createMock } };

      const result = await embedder.embed('hello');
      expect(createMock).toHaveBeenCalledTimes(2);
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('throws immediately on 401 (no retry)', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });
      const createMock = vi.fn();

      const authError = new Error('Unauthorized');
      (authError as any).status = 401;
      createMock.mockRejectedValueOnce(authError);

      (embedder as any).client = { embeddings: { create: createMock } };

      await expect(embedder.embed('hello')).rejects.toThrow('Unauthorized');
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('throws after max retries exhausted', async () => {
      const embedder = new OpenAIEmbedder({ apiKey: 'test-key' });
      const createMock = vi.fn();

      const rateLimitError = new Error('Rate limited');
      (rateLimitError as any).status = 429;
      createMock.mockRejectedValue(rateLimitError);

      (embedder as any).client = { embeddings: { create: createMock } };

      await expect(embedder.embed('hello')).rejects.toThrow('Rate limited');
      expect(createMock).toHaveBeenCalledTimes(3);
    });
  });
});
