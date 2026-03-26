#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { AnvilServer } from './server.js';

function parseArgs(argv: string[]): { docs?: string; db?: string } {
  const result: { docs?: string; db?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--docs' && argv[i + 1]) {
      result.docs = argv[++i];
    } else if (argv[i] === '--db' && argv[i + 1]) {
      result.db = argv[++i];
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (!args.docs) {
  process.stderr.write('Error: --docs <path> is required\nUsage: anvil --docs ./path/to/docs/\n');
  process.exit(1);
}

const docsRoot = resolve(args.docs);
if (!existsSync(docsRoot)) {
  process.stderr.write(`Error: docs directory not found: ${docsRoot}\n`);
  process.exit(1);
}

const server = new AnvilServer({
  docsRoot,
  dbPath: args.db ? resolve(args.db) : undefined,
});

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.start().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
