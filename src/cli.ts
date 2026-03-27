#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import { AnvilServer } from './server.js';

function loadVersion(): string {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createProgram(): Command {
  const program = new Command();
  const version = loadVersion();

  program
    .name('anvil')
    .description('Anvil — MCP server for project documentation')
    .version(version, '-v, --version')
    .allowExcessArguments(false)
    .enablePositionalOptions()
    .passThroughOptions();

  // Global options shared across subcommands
  const globalFlags = (cmd: Command): Command =>
    cmd
      .option('-d, --docs <path>', 'Path to docs directory', './')
      .option('--db <path>', 'Path to sqlite DB file')
      .option('-c, --config <path>', 'Path to config file', './anvil.config.json')
      .option('--no-config', 'Ignore config file even if present')
      .option('--no-watch', 'Disable file watcher')
      .option('--max-chunk-size <n>', 'Max chunk size in characters', '6000')
      .option('--min-chunk-size <n>', 'Min chunk size before merge-up', '200')
      .option('--embedding-provider <provider>', 'Embedding provider (local or openai)', 'local')
      .option('--log-level <level>', 'Log verbosity: silent, error, warn, info, debug', 'info');

  // serve subcommand
  const serve = new Command('serve')
    .description('Start the MCP server (default command)');
  globalFlags(serve);
  serve.action(async (opts) => {
    await runServe(opts);
  });

  // init subcommand (stub)
  const init = new Command('init')
    .description('Create anvil.config.json interactively')
    .option('--yes', 'Skip prompts, use all defaults')
    .action(() => {
      process.stderr.write('anvil init is not yet implemented (coming in S3)\n');
      process.exit(0);
    });

  // index subcommand (stub)
  const idx = new Command('index')
    .description('Index docs and exit (no MCP server)');
  globalFlags(idx);
  idx.option('--force', 'Force full re-index');
  idx.action(() => {
    process.stderr.write('anvil index is not yet implemented (coming in S4)\n');
    process.exit(0);
  });

  // Make serve the default command
  program.addCommand(serve, { isDefault: true });
  program.addCommand(init);
  program.addCommand(idx);

  return program;
}

async function runServe(opts: Record<string, unknown>): Promise<void> {
  const docsPath = opts.docs as string;
  const docsRoot = resolve(docsPath);

  if (!existsSync(docsRoot)) {
    process.stderr.write(`Error: docs directory not found: ${docsRoot}\n`);
    process.exit(1);
  }

  const server = new AnvilServer({
    docsRoot,
    dbPath: opts.db ? resolve(opts.db as string) : undefined,
  });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start().catch((err: Error) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}

// Only run when executed directly (not imported for testing)
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('/cli.js') || process.argv[1].endsWith('/cli.ts'));

if (isDirectRun) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err: Error) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
