#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AnvilServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getVersion(): Promise<string> {
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  return pkg.version;
}

function createProgram(): Command {
  const program = new Command();

  program
    .name('anvil')
    .description('🔨 Anvil — Make your docs queryable by AI agents')
    // version set after async load
    .option('-d, --docs <path>', 'Path to docs directory', './')
    .option('--db <path>', 'Path to SQLite DB file')
    .option('-c, --config <path>', 'Path to config file', './anvil.config.json')
    .option('--no-config', 'Ignore config file even if present')
    .option('--no-watch', 'Disable file watcher')
    .option('--max-chunk-size <n>', 'Max chunk size in characters', '6000')
    .option('--min-chunk-size <n>', 'Min chunk size before merge-up', '200')
    .option('--embedding-provider <provider>', 'Embedding provider (local or openai)', 'local')
    .option('--log-level <level>', 'Log verbosity: silent, error, warn, info, debug', 'info');

  // serve subcommand
  const serve = new Command('serve')
    .description('Start the MCP server (default command)')
    .option('-d, --docs <path>', 'Path to docs directory')
    .option('--db <path>', 'Path to SQLite DB file')
    .option('--no-watch', 'Disable file watcher')
    .option('--max-chunk-size <n>', 'Max chunk size in characters')
    .option('--min-chunk-size <n>', 'Min chunk size before merge-up')
    .option('--embedding-provider <provider>', 'Embedding provider (local or openai)')
    .option('--log-level <level>', 'Log verbosity: silent, error, warn, info, debug')
    .action(async (opts) => {
      await runServe(mergeOpts(program.opts(), opts));
    });

  // init subcommand (stub)
  const init = new Command('init')
    .description('Create anvil.config.json interactively')
    .option('--yes', 'Skip prompts, use defaults')
    .action(() => {
      process.stderr.write('anvil init is not yet implemented. Coming in a future release.\n');
      process.exit(0);
    });

  // index subcommand (stub)
  const index = new Command('index')
    .description('Index docs without starting the server')
    .option('-d, --docs <path>', 'Path to docs directory')
    .option('--db <path>', 'Path to SQLite DB file')
    .option('--force', 'Force full re-index')
    .option('--max-chunk-size <n>', 'Max chunk size in characters')
    .option('--min-chunk-size <n>', 'Min chunk size before merge-up')
    .option('--embedding-provider <provider>', 'Embedding provider (local or openai)')
    .option('--log-level <level>', 'Log verbosity: silent, error, warn, info, debug')
    .action(() => {
      process.stderr.write('anvil index is not yet implemented. Coming in a future release.\n');
      process.exit(0);
    });

  program.addCommand(serve);
  program.addCommand(init);
  program.addCommand(index);

  // Default action: if no subcommand, run serve
  program.action(async (opts) => {
    await runServe(opts);
  });

  return program;
}

interface ResolvedOpts {
  docs?: string;
  db?: string;
  watch?: boolean;
  config?: string;
  maxChunkSize?: string;
  minChunkSize?: string;
  embeddingProvider?: string;
  logLevel?: string;
}

function mergeOpts(global: ResolvedOpts, local: ResolvedOpts): ResolvedOpts {
  return {
    docs: local.docs ?? global.docs,
    db: local.db ?? global.db,
    watch: local.watch ?? global.watch,
    config: global.config,
    maxChunkSize: local.maxChunkSize ?? global.maxChunkSize,
    minChunkSize: local.minChunkSize ?? global.minChunkSize,
    embeddingProvider: local.embeddingProvider ?? global.embeddingProvider,
    logLevel: local.logLevel ?? global.logLevel,
  };
}

async function runServe(opts: ResolvedOpts): Promise<void> {
  const docsPath = opts.docs ?? './';
  const docsRoot = resolve(docsPath);

  if (!existsSync(docsRoot)) {
    process.stderr.write(
      `✗ Docs directory not found: ${docsRoot}\n  Check the --docs flag or anvil.config.json.\n`
    );
    process.exit(1);
  }

  const server = new AnvilServer({
    docsRoot,
    dbPath: opts.db ? resolve(opts.db) : undefined,
    watch: opts.watch !== false,
  });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}

async function main(): Promise<void> {
  const program = createProgram();
  const version = await getVersion();
  program.version(version, '-v, --version');

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
