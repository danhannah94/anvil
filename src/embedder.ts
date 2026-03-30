import OpenAI from 'openai';

// --- Interface ---

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  init(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch?(texts: string[]): Promise<Float32Array[]>;
}

// --- Local Embedder (Xenova/all-MiniLM-L6-v2) ---

export class LocalEmbedder implements EmbeddingProvider {
  private pipe: any = null;
  readonly dimensions = 384;
  readonly modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2';
  }

  async init(): Promise<void> {
    process.stderr.write(`[anvil] Loading embedding model: ${this.modelName}\n`);
    try {
      const { pipeline } = await import('@huggingface/transformers');
      this.pipe = await (pipeline as any)('feature-extraction', this.modelName, {
        dtype: 'fp32',
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      throw new Error(
        `✗ Failed to load embedding model: ${this.modelName}\n` +
        `  ${msg}\n\n` +
        `  The model is downloaded automatically on first run (~80 MB).\n` +
        `  Common causes:\n` +
        `  • No internet connection or firewall blocking huggingface.co\n` +
        `  • Disk full — model is cached in ~/.cache/huggingface/\n` +
        `  • Invalid model name — check your config\n\n` +
        `  To retry, ensure you have internet access and run anvil again.`
      );
    }
    process.stderr.write(`[anvil] Model loaded.\n`);
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.pipe) throw new Error('Embedder not initialized. Call init() first.');
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data as Float64Array);
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<Float32Array[]> {
    if (!this.pipe) throw new Error('Embedder not initialized. Call init() first.');
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      for (const text of batch) {
        const output = await this.pipe(text, { pooling: 'mean', normalize: true });
        results.push(new Float32Array(output.data as Float64Array));
      }
    }
    return results;
  }
}

// --- OpenAI Embedder ---

const MAX_BATCH_SIZE = 2048;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly dimensions = 1536;
  readonly modelName: string;
  private client: OpenAI;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OpenAI API key required. Set embedding.apiKey or OPENAI_API_KEY env var.'
      );
    }
    this.modelName = opts?.model ?? 'text-embedding-3-small';
    this.client = new OpenAI({ apiKey });
  }

  async init(): Promise<void> {
    // No-op — OpenAI client is ready immediately
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const allResults: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const response = await this.requestWithRetry(batch);

      // Sort by index to preserve order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        allResults.push(new Float32Array(item.embedding));
      }
    }

    return allResults;
  }

  private async requestWithRetry(
    input: string[],
  ): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.client.embeddings.create({
          model: this.modelName,
          input,
        });
      } catch (err: unknown) {
        lastError = err;
        const status = (err as any)?.status;
        if (status === 429 || (status >= 500 && status < 600)) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }
}

// --- Factory ---

export function createEmbedder(config?: {
  provider?: 'local' | 'openai';
  model?: string;
  apiKey?: string;
}): EmbeddingProvider {
  const provider = config?.provider ?? 'local';

  if (provider === 'openai') {
    return new OpenAIEmbedder({
      apiKey: config?.apiKey,
      model: config?.model ?? 'text-embedding-3-small',
    });
  }

  return new LocalEmbedder(
    config?.model ? `Xenova/${config.model}` : 'Xenova/all-MiniLM-L6-v2',
  );
}

// Backward compat
export { LocalEmbedder as Embedder };
