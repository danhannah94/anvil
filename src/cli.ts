#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import { AnvilServer } from './server.js';
import { runIndex } from './commands/index.js';
import { runInit } from './commands/init.js';
import { setLogLevel, type LogLevel } from './logger.js';
import { resolveConfig, type CLIFlags } from './config.js';

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
  serve.action(async (opts: Record<string, unknown>, cmd: Command) => {
    await runServe(opts, cmd);
  });

  // init subcommand
  const init = new Command('init')
    .description('Create anvil.config.json interactively')
    .option('--yes', 'Skip prompts, use all defaults')
    .action(async (opts: { yes?: boolean }) => {
      try {
        await runInit({ yes: opts.yes });
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });

  // index subcommand (stub)
  const idx = new Command('index')
    .description('Index docs and exit (no MCP server)');
  globalFlags(idx);
  idx.option('--force', 'Force full re-index');
  idx.action(async (opts) => {
    await runIndex(opts);
  });

  // Make serve the default command
  program.addCommand(serve, { isDefault: true });
  program.addCommand(init);
  program.addCommand(idx);

  return program;
}

/** Extract explicitly-set CLI option names from commander */
function getExplicitFlags(cmd: Command): Set<string> {
  const explicit = new Set<string>();
  for (const opt of cmd.options) {
    const key = opt.attributeName();
    const source = cmd.getOptionValueSource(key);
    if (source === 'cli') {
      explicit.add(key);
    }
  }
  return explicit;
}

async function runServe(opts: Record<string, unknown>, cmd: Command): Promise<void> {
  const cliExplicit = getExplicitFlags(cmd);
  const cliFlags: CLIFlags = {
    docs: opts.docs as string | undefined,
    db: opts.db as string | undefined,
    watch: opts.watch as boolean | undefined,
    config: opts.config as string | false | undefined,
    maxChunkSize: opts.maxChunkSize as string | undefined,
    minChunkSize: opts.minChunkSize as string | undefined,
    embeddingProvider: opts.embeddingProvider as string | undefined,
    logLevel: opts.logLevel as string | undefined,
  };

  let resolved;
  try {
    resolved = resolveConfig(cliFlags, cliExplicit);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  for (const w of resolved.warnings) {
    process.stderr.write(`Warning: ${w}\n`);
  }

  const { config } = resolved;

  setLogLevel(config.logLevel as LogLevel);

  const docsRoot = resolve(config.docs);

  if (!existsSync(docsRoot)) {
    process.stderr.write(`Error: docs directory not found: ${docsRoot}\n`);
    process.exit(1);
  }

  const version = loadVersion();

  process.stderr.write(`\n🔨 Anvil v${version}\n`);
  process.stderr.write(`  Docs:      ${docsRoot}\n`);
  process.stderr.write(`  Embedding: ${config.embedding.provider} (${config.embedding.model})\n`);
  process.stderr.write(`  Watch:     ${config.watch ? 'enabled' : 'disabled'}\n`);
  process.stderr.write(`  Transport: stdio\n`);
  if (resolved.configPath) {
    process.stderr.write(`  Config:    ${resolved.configPath}\n`);
  }
  process.stderr.write(`\n`);

  const server = new AnvilServer({
    docsRoot,
    dbPath: resolve(config.db),
    watch: config.watch,
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
