import { AnvilDatabase } from './db.js';
import type { EmbeddingProvider } from './embedder.js';
import { chunkMarkdown } from './chunker.js';

export class Indexer {
  constructor(
    private db: AnvilDatabase,
    private embedder: EmbeddingProvider,
  ) {}

  async indexFile(
    filePath: string,
    content: string,
    lastModified: string,
  ): Promise<{ added: number; updated: number; unchanged: number; removed: number }> {
    // Check for model mismatch
    const storedModel = this.db.getMeta('embedding_model');
    const storedDims = this.db.getMeta('embedding_dimensions');
    const currentModel = this.embedder.modelName;
    const currentDims = String(this.embedder.dimensions);
    const modelMismatch =
      storedModel !== null &&
      storedDims !== null &&
      (storedModel !== currentModel || storedDims !== currentDims);

    if (modelMismatch) {
      process.stderr.write(
        `[anvil] WARNING: Embedding model changed (${storedModel} → ${currentModel}). Full re-embed triggered.\n`,
      );
    }

    const newChunks = chunkMarkdown(content, filePath, lastModified);
    const existing = this.db.getChunksByFile(filePath);
    const existingMap = new Map(existing.map((c) => [c.chunk_id, c.content_hash]));
    const newChunkIds = new Set(newChunks.map((c) => c.chunk_id));

    let added = 0;
    let updated = 0;
    let unchanged = 0;

    const toEmbed: { index: number; isNew: boolean }[] = [];

    for (let i = 0; i < newChunks.length; i++) {
      const chunk = newChunks[i];
      const existingHash = existingMap.get(chunk.chunk_id);
      if (existingHash !== undefined && existingHash === chunk.content_hash && !modelMismatch) {
        unchanged++;
      } else if (existingHash !== undefined) {
        toEmbed.push({ index: i, isNew: false });
      } else {
        toEmbed.push({ index: i, isNew: true });
      }
    }

    // Embed only changed chunks
    if (toEmbed.length > 0) {
      const texts = toEmbed.map((e) => newChunks[e.index].content);
      const embeddings = this.embedder.embedBatch
        ? await this.embedder.embedBatch(texts)
        : await Promise.all(texts.map((t) => this.embedder.embed(t)));

      for (let j = 0; j < toEmbed.length; j++) {
        const { index, isNew } = toEmbed[j];
        this.db.upsertChunk(newChunks[index], embeddings[j]);
        if (isNew) added++;
        else updated++;
      }
    }

    // Remove chunks no longer present
    let removed = 0;
    for (const ex of existing) {
      if (!newChunkIds.has(ex.chunk_id)) {
        this.db.deleteChunk(ex.chunk_id);
        removed++;
      }
    }

    // Update meta
    this.db.setMeta('embedding_model', currentModel);
    this.db.setMeta('embedding_dimensions', currentDims);
    this.db.setMeta('last_index_timestamp', new Date().toISOString());

    return { added, updated, unchanged, removed };
  }

  removeFile(filePath: string): void {
    this.db.deleteFileChunks(filePath);
  }
}
