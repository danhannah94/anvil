/**
 * `anvil index` — one-shot index command.
 * Indexes docs and exits (no MCP server, no file watcher).
 */

import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { AnvilDatabase } from '../db.js';
import { Embedder } from '../embedder.js';
import { Indexer } from '../indexer.js';
import { logger, formatBytes, formatDuration, setLogLevel, type LogLevel } from '../logger.js';

export interface IndexCommandOptions {
  docs: string;
  db?: string;
  force?: boolean;
  logLevel?: string;
  maxChunkSize?: string;
  minChunkSize?: string;
  embeddingProvider?: string;
}

export async function runIndex(opts: IndexCommandOptions): Promise<void> {
  if (opts.logLevel) {
    setLogLevel(opts.logLevel as LogLevel);
  }

  const docsRoot = resolve(opts.docs);

  if (!existsSync(docsRoot)) {
    logger.error(`Error: docs directory not found: ${docsRoot}\n`);
    process.exit(1);
  }

  const dbPath = opts.db ? resolve(opts.db) : join(docsRoot, '.anvil', 'index.db');

  logger.info(`\n🔨 Indexing ${opts.docs}\n`);

  // Scan markdown files
  const mdFiles = await scanMarkdownFiles(docsRoot);
  logger.info(`  Found ${mdFiles.length} markdown files\n`);

  if (mdFiles.length === 0) {
    logger.info(`\n✅ Index complete: 0 pages, 0 chunks\n`);
    return;
  }

  // Init DB and embedder
  const db = new AnvilDatabase(dbPath);
  const embedder = new Embedder();
  await embedder.init();
  const indexer = new Indexer(db, embedder);

  // If --force, clear all existing chunks first
  if (opts.force) {
    logger.info(`  Force mode: clearing existing index\n`);
    const existingFiles = db.getDistinctFiles();
    for (const f of existingFiles) {
      db.deleteFileChunks(f);
    }
  }

  // Index all files
  let totalChunks = 0;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;

  const startTime = Date.now();

  for (let i = 0; i < mdFiles.length; i++) {
    const rel = mdFiles[i];
    const absPath = join(docsRoot, rel);
    const content = await readFile(absPath, 'utf-8');
    const fileStat = await stat(absPath);
    const result = await indexer.indexFile(rel, content, fileStat.mtime.toISOString());
    totalAdded += result.added;
    totalUpdated += result.updated;
    totalUnchanged += result.unchanged;
    totalChunks += result.added + result.updated + result.unchanged;
  }

  // Prune deleted files
  const allChunks = db.getAllChunks();
  const dbFiles = new Set(allChunks.map((c) => c.file_path));
  const diskFiles = new Set(mdFiles);
  for (const dbFile of dbFiles) {
    if (!diskFiles.has(dbFile)) {
      indexer.removeFile(dbFile);
    }
  }

  const elapsed = Date.now() - startTime;

  logger.info(`  Chunked into ${totalChunks} sections\n`);
  logger.info(`  Generating embeddings... done (${formatDuration(elapsed)})\n`);

  // DB file size
  try {
    const dbStat = statSync(dbPath);
    logger.info(`  Wrote ${dbPath} (${formatBytes(dbStat.size)})\n`);
  } catch {
    // DB path might not exist if 0 chunks
  }

  logger.info(`\n✅ Index complete: ${mdFiles.length} pages, ${totalChunks} chunks\n`);

  db.close();
}

async function scanMarkdownFiles(dir: string, base?: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '.anvil' || entry.name === 'node_modules') continue;
      result.push(...(await scanMarkdownFiles(join(dir, entry.name), rel)));
    } else if (entry.name.endsWith('.md')) {
      result.push(rel);
    }
  }
  return result;
}
