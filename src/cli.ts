#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import { AnvilServer } from './server.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
);

export function createProgram(argv?: string[]): Command {
  const program = new Command();

  program
    .name('anvil')
    .description('MCP server for semantic documentation search')
    .version(pkg.version, '-v, --version')
    .option('-d, --docs <path>', 'path to docs directory', './')
    .option('--db <path>', 'path to sqlite DB file')
    .option('-c, --config <path>', 'path to config file', './anvil.config.json')
    .option('--no-config', 'ignore config file even if present')
    .option('--no-watch', 'disable file watcher')
    .option('--max-chunk-size <n>', 'max chunk size in characters', '6000')
    .option('--min-chunk-size <n>', 'min chunk size before merge-up', '200')
    .option('--embedding-provider <provider>', 'embedding provider', 'local')
    .option('--log-level <level>', 'log verbosity: silent, error, warn, info, debug', 'info');

  const serveCommand = new Command('serve')
    .description('start the Anvil MCP server (default command)')
    .option('-d, --docs <path>', 'path to docs directory')
    .option('--db <path>', 'path to sqlite DB file')
    .option('--no-watch', 'disable file watcher')
    .option('--max-chunk-size <n>', 'max chunk size in characters')
    .option('--min-chunk-size <n>', 'min chunk size before merge-up')
    .option('--embedding-provider <provider>', 'embedding provider')
    .option('--log-level <level>', 'log verbosity')
    .action(async (opts) => {
      // Merge parent (program) options with serve-specific options
      const parentOpts = program.opts();
      const merged = { ...parentOpts, ...stripUndefined(opts) };
      await runServe(merged);
    });

  program.addCommand(serveCommand);

  program
    .command('init')
    .description('initialize Anvil config in a project')
    .action(() => {
      console.log('anvil init: not yet implemented');
    });

  program
    .command('index')
    .description('index documentation for search')
    .action(() => {
      console.log('anvil index: not yet implemented');
    });

  // Default to serve when no subcommand given
  program.action(async (opts) => {
    await runServe(opts);
  });

  if (argv) {
    program.parse(argv, { from: 'user' });
  } else {
    program.parse();
  }

  return program;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

async function runServe(opts: Record<string, unknown>): Promise<void> {
  const docsPath = (opts.docs as string) || './';
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

  try {
    await server.start();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

createProgram();
