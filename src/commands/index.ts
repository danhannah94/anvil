/**
 * `anvil index` — one-shot index command.
 * Indexes docs and exits (no MCP server, no file watcher).
 */

import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { createAnvil, scanMarkdownFiles } from '../anvil.js';
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
    logger.error(
      `✗ Docs directory not found: ${docsRoot}\n` +
      `  Check the --docs flag or anvil.config.json.\n`
    );
    process.exit(1);
  }

  const dbPath = opts.db ? resolve(opts.db) : join(docsRoot, '.anvil', 'index.db');

  logger.info(`\n🔨 Indexing ${opts.docs}\n`);

  // Scan for files first (to handle empty directory without creating embedder)
  const mdFiles = await scanMarkdownFiles(docsRoot);
  logger.info(`  Found ${mdFiles.length} markdown files\n`);

  if (mdFiles.length === 0) {
    logger.info(`\n✅ Index complete: 0 pages, 0 chunks\n`);
    return;
  }

  // Create Anvil and index
  const anvil = await createAnvil({ docsPath: docsRoot, dbPath });
  const result = await anvil.index({ force: opts.force });

  const totalChunks = result.chunks_added + result.chunks_updated + result.chunks_unchanged;
  logger.info(`  Chunked into ${totalChunks} sections\n`);
  logger.info(`  Generating embeddings... done (${formatDuration(result.duration_ms)})\n`);

  await anvil.close();

  // DB file size
  try {
    const dbStat = statSync(dbPath);
    logger.info(`  Wrote ${dbPath} (${formatBytes(dbStat.size)})\n`);
  } catch {
    // DB path might not exist if 0 chunks
  }

  logger.info(`\n✅ Index complete: ${mdFiles.length} pages, ${totalChunks} chunks\n`);
}
