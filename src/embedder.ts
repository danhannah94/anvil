export class Embedder {
  private pipe: any = null;
  private modelName: string;
  private dimensions: number;

  constructor(modelName?: string) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2';
    this.dimensions = 384;
  }

  async init(): Promise<void> {
    process.stderr.write(`[anvil] Loading embedding model: ${this.modelName}\n`);
    const { pipeline } = await import('@huggingface/transformers');
    this.pipe = await (pipeline as any)('feature-extraction', this.modelName, {
      dtype: 'fp32',
    });
    process.stderr.write(`[anvil] Model loaded.\n`);
  }

  async embedChunks(texts: string[], batchSize = 32): Promise<Float32Array[]> {
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

  async embedQuery(text: string): Promise<Float32Array> {
    const [result] = await this.embedChunks([text]);
    return result;
  }

  getModelName(): string {
    return this.modelName;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
