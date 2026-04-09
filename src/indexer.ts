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
  ): Promise<{ added: number; updated: number; unchanged: number; reordered: number; removed: number }> {
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
    // Track both content_hash and ordinal so we can detect chunks whose
    // content didn't change but whose document position shifted (e.g. when
    // a new section was inserted earlier in the file). Without re-syncing
    // the ordinal, ORDER BY ordinal queries return chunks in stale order.
    const existingMap = new Map(
      existing.map((c) => [c.chunk_id, { hash: c.content_hash, ordinal: c.ordinal }]),
    );
    const newChunkIds = new Set(newChunks.map((c) => c.chunk_id));

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let reordered = 0;

    const toEmbed: { index: number; isNew: boolean }[] = [];

    for (let i = 0; i < newChunks.length; i++) {
      const chunk = newChunks[i];
      const existingEntry = existingMap.get(chunk.chunk_id);
      if (existingEntry !== undefined && existingEntry.hash === chunk.content_hash && !modelMismatch) {
        // Content unchanged — but if the document position shifted, we still
        // need to update the ordinal so queries return chunks in current
        // document order. No re-embedding required.
        if (existingEntry.ordinal !== chunk.ordinal) {
          this.db.updateChunkOrdinal(chunk.chunk_id, chunk.ordinal);
          reordered++;
        }
        unchanged++;
      } else if (existingEntry !== undefined) {
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

    return { added, updated, unchanged, reordered, removed };
  }

  removeFile(filePath: string): void {
    this.db.deleteFileChunks(filePath);
  }
}
