import { AnvilDatabase } from "./db.js";
import { createEmbedder, type EmbeddingProvider } from "./embedder.js";
import { Indexer } from "./indexer.js";
import { QueryEngine } from "./query.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// Re-export types from query.ts
export type {
  SearchResult,
  PageResult,
  SectionResult,
  PageSummary,
} from "./query.js";

export interface AnvilConfig {
  docsPath: string;
  dbPath?: string;
  embedding?: {
    provider?: "local" | "openai";
    model?: string;
    apiKey?: string;
  };
}

export interface StatusResult {
  total_pages: number;
  total_chunks: number;
  last_indexed: string | null;
  embedding: { provider: string; model: string; dimensions: number };
  db_path: string;
  docs_path: string;
}

export interface IndexResult {
  files_processed: number;
  chunks_added: number;
  chunks_updated: number;
  chunks_unchanged: number;
  chunks_deleted: number;
  duration_ms: number;
}

export interface Anvil {
  search(
    query: string,
    topK?: number,
  ): Promise<import("./query.js").SearchResult[]>;
  getPage(filePath: string): Promise<import("./query.js").PageResult | null>;
  getSection(
    filePath: string,
    headingPath: string,
  ): Promise<import("./query.js").SectionResult | null>;
  listPages(
    prefix?: string,
  ): Promise<{
    pages: import("./query.js").PageSummary[];
    total_pages: number;
  }>;
  getStatus(): Promise<StatusResult>;
  index(options?: { force?: boolean }): Promise<IndexResult>;
  reindexFiles(files: string[]): Promise<IndexResult>;
  close(): Promise<void>;
}

export async function scanMarkdownFiles(
  dir: string,
  base?: string,
): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === ".anvil" || entry.name === "node_modules") continue;
      result.push(...(await scanMarkdownFiles(join(dir, entry.name), rel)));
    } else if (entry.name.endsWith(".md")) {
      result.push(rel);
    }
  }
  return result;
}

export async function createAnvil(config: AnvilConfig): Promise<Anvil> {
  // Validate docsPath
  if (!config.docsPath) {
    throw new Error("docsPath is required");
  }

  const docsPath = config.docsPath;

  try {
    const s = await stat(docsPath);
    if (!s.isDirectory()) throw new Error("path exists but is not a directory");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `docsPath does not exist: ${docsPath}`,
      );
    }
    throw new Error(
      `docsPath is not a valid directory: ${docsPath}`,
    );
  }

  // Create embedder
  const embedder: EmbeddingProvider = createEmbedder(config.embedding);
  await embedder.init();

  // Create DB
  const dbPath =
    config.dbPath ?? join(docsPath, ".anvil", "index.db");
  const db = new AnvilDatabase(dbPath, embedder.dimensions);

  // Re-embed if needed (dimension mismatch)
  if (db.needsReembed()) {
    const allChunks = db.getAllChunks();
    process.stderr.write(
      `[anvil] Re-embedding ${allChunks.length} chunks...\n`,
    );
    for (const chunk of allChunks) {
      const embedding = await embedder.embed(chunk.content);
      db.upsertChunk(chunk, embedding);
    }
    db.clearReembedFlag();
    process.stderr.write(`[anvil] Re-embedding complete.\n`);
  }

  // Create indexer and query engine
  const indexer = new Indexer(db, embedder);
  const queryEngine = new QueryEngine(db, embedder);

  const anvil: Anvil = {
    async search(query, topK?) {
      const result = await queryEngine.vectorSearch(query, topK);
      return result.results;
    },

    getPage(filePath) {
      return Promise.resolve(queryEngine.getPageChunks(filePath));
    },

    getSection(filePath, headingPath) {
      return Promise.resolve(
        queryEngine.getSectionChunks(filePath, headingPath),
      );
    },

    listPages(prefix?) {
      return Promise.resolve(queryEngine.listPages(prefix));
    },

    async getStatus() {
      const allChunks = db.getAllChunks();
      const files = db.getDistinctFiles();
      const lastIndexed = db.getMeta("last_index_timestamp");
      const provider = config.embedding?.provider ?? "local";
      return {
        total_pages: files.length,
        total_chunks: allChunks.length,
        last_indexed: lastIndexed,
        embedding: {
          provider,
          model: embedder.modelName,
          dimensions: embedder.dimensions,
        },
        db_path: dbPath,
        docs_path: docsPath,
      };
    },

    async index(options?) {
      const start = Date.now();
      const force = options?.force ?? false;

      const mdFiles = await scanMarkdownFiles(docsPath);
      let totalAdded = 0;
      let totalUpdated = 0;
      let totalUnchanged = 0;
      let totalRemoved = 0;

      for (const rel of mdFiles) {
        const absPath = join(docsPath, rel);
        const content = await readFile(absPath, "utf-8");
        const fileStat = await stat(absPath);

        if (force) {
          // Force re-index: delete existing chunks first so indexer treats all as new
          indexer.removeFile(rel);
        }

        const result = await indexer.indexFile(
          rel,
          content,
          fileStat.mtime.toISOString(),
        );
        totalAdded += result.added;
        totalUpdated += result.updated;
        totalUnchanged += result.unchanged;
        totalRemoved += result.removed;
      }

      // Prune deleted files
      const allChunks = db.getAllChunks();
      const dbFiles = new Set(allChunks.map((c) => c.file_path));
      const diskFiles = new Set(mdFiles);
      for (const dbFile of dbFiles) {
        if (!diskFiles.has(dbFile)) {
          const fileChunks = db.getChunksByFile(dbFile);
          totalRemoved += fileChunks.length;
          indexer.removeFile(dbFile);
        }
      }

      return {
        files_processed: mdFiles.length,
        chunks_added: totalAdded,
        chunks_updated: totalUpdated,
        chunks_unchanged: totalUnchanged,
        chunks_deleted: totalRemoved,
        duration_ms: Date.now() - start,
      };
    },

    async reindexFiles(files: string[]): Promise<IndexResult> {
      const start = Date.now();
      let totalAdded = 0;
      let totalUpdated = 0;
      let totalUnchanged = 0;
      let totalRemoved = 0;

      for (const rel of files) {
        const absPath = join(docsPath, rel);

        try {
          const fileStat = await stat(absPath);
          if (!fileStat.isFile()) continue;

          const content = await readFile(absPath, "utf-8");
          const result = await indexer.indexFile(
            rel,
            content,
            fileStat.mtime.toISOString(),
          );
          totalAdded += result.added;
          totalUpdated += result.updated;
          totalUnchanged += result.unchanged;
          totalRemoved += result.removed;
        } catch (err) {
          // File doesn't exist on disk — it was deleted
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            const existingChunks = db.getChunksByFile(rel);
            if (existingChunks.length > 0) {
              totalRemoved += existingChunks.length;
              indexer.removeFile(rel);
            }
          } else {
            throw err;
          }
        }
      }

      return {
        files_processed: files.length,
        chunks_added: totalAdded,
        chunks_updated: totalUpdated,
        chunks_unchanged: totalUnchanged,
        chunks_deleted: totalRemoved,
        duration_ms: Date.now() - start,
      };
    },

    async close() {
      db.close();
    },
  };

  return anvil;
}
