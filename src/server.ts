import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AnvilDatabase } from './db.js';
import { type EmbeddingProvider, LocalEmbedder } from './embedder.js';
import { Indexer } from './indexer.js';
import { FileWatcher } from './watcher.js';
import { QueryEngine } from './query.js';
import { registerAllTools } from './tools/index.js';

export interface AnvilServerOptions {
  docsRoot: string;
  dbPath?: string;
  watch?: boolean;
}

export class AnvilServer {
  private db!: AnvilDatabase;
  private embedder!: EmbeddingProvider;
  private indexer!: Indexer;
  private watcher: FileWatcher | null = null;
  private mcpServer!: Server;
  private queryEngine!: QueryEngine;
  private stopped = false;

  constructor(private options: AnvilServerOptions) {}

  async start(): Promise<void> {
    // 1. Validate docsRoot
    try {
      const s = await stat(this.options.docsRoot);
      if (!s.isDirectory()) throw new Error('path exists but is not a directory');
    } catch (err) {
      throw new Error(
        `✗ Docs directory not found: ${this.options.docsRoot}\n` +
        `  Anvil needs a directory of markdown files to index.\n` +
        `  Check the --docs flag or anvil.config.json.`
      );
    }

    // 2. Create DB
    const dbPath = this.options.dbPath ?? join(this.options.docsRoot, '.anvil', 'index.db');
    this.db = new AnvilDatabase(dbPath);

    // 3. Init embedder
    this.embedder = new LocalEmbedder();
    await this.embedder.init();

    // 4. Create indexer
    this.indexer = new Indexer(this.db, this.embedder);

    // 5. Full index
    const mdFiles = await this.scanMarkdownFiles(this.options.docsRoot);
    process.stderr.write(`[anvil] Indexing: ${mdFiles.length} files found\n`);

    let totalChunks = 0;
    for (let i = 0; i < mdFiles.length; i++) {
      const rel = mdFiles[i];
      const absPath = join(this.options.docsRoot, rel);
      const content = await readFile(absPath, 'utf-8');
      const fileStat = await stat(absPath);
      const result = await this.indexer.indexFile(rel, content, fileStat.mtime.toISOString());
      totalChunks += result.added + result.updated + result.unchanged;
      process.stderr.write(`[anvil] Indexed ${i + 1}/${mdFiles.length} files\n`);
    }

    // Prune deleted files
    const allChunks = this.db.getAllChunks();
    const dbFiles = new Set(allChunks.map((c) => c.file_path));
    const diskFiles = new Set(mdFiles);
    for (const dbFile of dbFiles) {
      if (!diskFiles.has(dbFile)) {
        this.indexer.removeFile(dbFile);
      }
    }

    process.stderr.write(`[anvil] Index complete: ${totalChunks} chunks\n`);

    // 6. Start watcher
    if (this.options.watch !== false) {
      this.watcher = new FileWatcher(
        this.options.docsRoot,
        async (filePath) => {
          const absPath = join(this.options.docsRoot, filePath);
          const content = await readFile(absPath, 'utf-8');
          const fileStat = await stat(absPath);
          await this.indexer.indexFile(filePath, content, fileStat.mtime.toISOString());
        },
        async (filePath) => {
          this.indexer.removeFile(filePath);
        },
      );
      await this.watcher.start();
    }

    // 7. Create query engine
    this.queryEngine = new QueryEngine(this.db, this.embedder);

    // 8. Create MCP server
    this.mcpServer = new Server(
      { name: 'anvil', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    // 9. Register tools
    registerAllTools(this.mcpServer, this.queryEngine, () => this.checkStaleness(), {
      docsRoot: this.options.docsRoot,
      dbPath: dbPath,
      db: this.db,
      startTime: Date.now(),
      version: '0.1.0',
    });

    // 10. Connect stdio transport
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    process.stderr.write(`[anvil] MCP server ready (5 tools registered)\n`);
  }

  async checkStaleness(): Promise<void> {
    const lastTimestamp = this.db.getMeta('last_index_timestamp');
    const lastTime = lastTimestamp ? new Date(lastTimestamp).getTime() : 0;

    const mdFiles = await this.scanMarkdownFiles(this.options.docsRoot);
    const diskFiles = new Set(mdFiles);

    // Check for modified or new files
    for (const rel of mdFiles) {
      const absPath = join(this.options.docsRoot, rel);
      const fileStat = await stat(absPath);
      if (fileStat.mtime.getTime() > lastTime) {
        const content = await readFile(absPath, 'utf-8');
        await this.indexer.indexFile(rel, content, fileStat.mtime.toISOString());
      }
    }

    // Check for deleted files
    const allChunks = this.db.getAllChunks();
    const dbFiles = new Set(allChunks.map((c) => c.file_path));
    for (const dbFile of dbFiles) {
      if (!diskFiles.has(dbFile)) {
        this.indexer.removeFile(dbFile);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.watcher) await this.watcher.stop();
    if (this.mcpServer) await this.mcpServer.close();
    if (this.db) this.db.close();
  }

  // Expose for testing
  getDatabase(): AnvilDatabase {
    return this.db;
  }

  getQueryEngine(): QueryEngine {
    return this.queryEngine;
  }

  private async scanMarkdownFiles(dir: string, base?: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? join(base, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === '.anvil' || entry.name === 'node_modules') continue;
        result.push(...(await this.scanMarkdownFiles(join(dir, entry.name), rel)));
      } else if (entry.name.endsWith('.md')) {
        result.push(rel);
      }
    }
    return result;
  }
}
