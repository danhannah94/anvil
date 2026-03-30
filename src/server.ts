import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { join } from 'node:path';
import { createAnvil, scanMarkdownFiles, type Anvil } from './anvil.js';
import { AnvilDatabase } from './db.js';
import { FileWatcher } from './watcher.js';
import { registerAllTools } from './tools/index.js';

export interface AnvilServerOptions {
  docsRoot: string;
  dbPath?: string;
  watch?: boolean;
}

export class AnvilServer {
  private anvil!: Anvil;
  private watcher: FileWatcher | null = null;
  private mcpServer!: Server;
  private stopped = false;
  private dbPath!: string;

  constructor(private options: AnvilServerOptions) {}

  async start(): Promise<void> {
    this.dbPath = this.options.dbPath ?? join(this.options.docsRoot, '.anvil', 'index.db');

    // Create Anvil instance (handles embedder init, db creation)
    this.anvil = await createAnvil({
      docsPath: this.options.docsRoot,
      dbPath: this.dbPath,
    });

    // Initial full index
    const mdFiles = await scanMarkdownFiles(this.options.docsRoot);
    process.stderr.write(`[anvil] Indexing: ${mdFiles.length} files found\n`);
    const result = await this.anvil.index();
    const totalChunks = result.chunks_added + result.chunks_updated + result.chunks_unchanged;
    process.stderr.write(`[anvil] Index complete: ${totalChunks} chunks\n`);

    // Prune deleted files is handled by anvil.index()

    // File watcher — calls anvil.index() on changes (pragmatic: the Anvil API
    // does not expose per-file indexing, so we re-index all files on each change;
    // the indexer skips unchanged chunks via content hash, keeping this efficient)
    if (this.options.watch !== false) {
      this.watcher = new FileWatcher(
        this.options.docsRoot,
        async () => { await this.anvil.index(); },
        async () => { await this.anvil.index(); },
      );
      await this.watcher.start();
    }

    // Create MCP server
    this.mcpServer = new Server(
      { name: 'anvil', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    // Register tools
    registerAllTools(this.mcpServer, () => this.checkStaleness(), {
      anvil: this.anvil,
      startTime: Date.now(),
      version: '0.1.0',
    });

    // Connect stdio transport
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    process.stderr.write(`[anvil] MCP server ready (5 tools registered)\n`);
  }

  async checkStaleness(): Promise<void> {
    // Delegates to anvil.index() which handles incremental updates
    // (skips unchanged chunks via content hash)
    await this.anvil.index();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.watcher) await this.watcher.stop();
    if (this.mcpServer) await this.mcpServer.close();
    if (this.anvil) await this.anvil.close();
  }

  // Expose for testing — opens a read connection to the same DB file
  getDatabase(): AnvilDatabase {
    return new AnvilDatabase(this.dbPath);
  }
}
