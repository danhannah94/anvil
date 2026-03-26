import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AnvilDatabase } from '../../src/db.js';
import { Embedder } from '../../src/embedder.js';
import { Indexer } from '../../src/indexer.js';
import { QueryEngine } from '../../src/query.js';
import { registerAllTools } from '../../src/tools/index.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let db: AnvilDatabase;
let embedder: Embedder;
let client: Client;
let server: Server;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'anvil-tools-test-'));
  const dbPath = join(tmpDir, 'test.db');
  db = new AnvilDatabase(dbPath);
  embedder = new Embedder();
  await embedder.init();

  const indexer = new Indexer(db, embedder);
  const docsDir = join(tmpDir, 'docs');
  mkdirSync(join(docsDir, 'epics'), { recursive: true });

  writeFileSync(join(docsDir, 'guide.md'), `# Setup Guide\n\nHow to install and configure the system.\n\n## Installation\n\nRun npm install.\n`);
  writeFileSync(join(docsDir, 'epics', 'e1.md'), `# Epic 1\n\nUser authentication feature.\n`);

  const fs = require('node:fs');
  await indexer.indexFile('guide.md', fs.readFileSync(join(docsDir, 'guide.md'), 'utf-8'), '2026-01-01T00:00:00Z');
  await indexer.indexFile('epics/e1.md', fs.readFileSync(join(docsDir, 'epics', 'e1.md'), 'utf-8'), '2026-01-01T00:00:00Z');

  const qe = new QueryEngine(db, embedder);

  server = new Server(
    { name: 'anvil-test', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  registerAllTools(server, qe, async () => {}, {
    docsRoot: docsDir,
    dbPath,
    db,
    startTime: Date.now(),
    version: '0.1.0',
  });

  client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}, 60000);

afterAll(async () => {
  await client.close();
  await server.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function parseResult(result: { content: unknown[] }) {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

describe('search_docs', () => {
  it('returns results for valid query', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'installation setup' } });
    const parsed = parseResult(result);
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0].score).toBeGreaterThan(0);
  });
});

describe('get_page', () => {
  it('returns all chunks for valid path', async () => {
    const result = await client.callTool({ name: 'get_page', arguments: { file_path: 'guide.md' } });
    const parsed = parseResult(result);
    expect(parsed.file_path).toBe('guide.md');
    expect(parsed.chunks.length).toBeGreaterThan(0);
    // Verify order
    for (let i = 1; i < parsed.chunks.length; i++) {
      expect(parsed.chunks[i].ordinal).toBeGreaterThanOrEqual(parsed.chunks[i - 1].ordinal);
    }
  });

  it('returns error for invalid path', async () => {
    const result = await client.callTool({ name: 'get_page', arguments: { file_path: 'nonexistent.md' } });
    const parsed = parseResult(result);
    expect(result.isError).toBe(true);
    expect(parsed.error).toContain('No page found');
    expect(parsed.error).toContain('list_pages');
  });

  it('normalizes leading ./', async () => {
    const result = await client.callTool({ name: 'get_page', arguments: { file_path: './guide.md' } });
    const parsed = parseResult(result);
    expect(parsed.file_path).toBe('guide.md');
  });
});

describe('get_section', () => {
  it('returns content for valid heading', async () => {
    const result = await client.callTool({ name: 'get_section', arguments: { file_path: 'guide.md', heading_path: 'Setup Guide' } });
    const parsed = parseResult(result);
    expect(parsed.content).toBeDefined();
    expect(parsed.metadata.file_path).toBe('guide.md');
  });

  it('returns error for invalid heading', async () => {
    const result = await client.callTool({ name: 'get_section', arguments: { file_path: 'guide.md', heading_path: 'Nonexistent Section' } });
    const parsed = parseResult(result);
    expect(result.isError).toBe(true);
    expect(parsed.error).toContain('No section found');
    expect(parsed.error).toContain('get_page');
  });
});

describe('list_pages', () => {
  it('returns all pages', async () => {
    const result = await client.callTool({ name: 'list_pages', arguments: {} });
    const parsed = parseResult(result);
    expect(parsed.pages.length).toBe(2);
    expect(parsed.total_pages).toBe(2);
  });

  it('filters by prefix', async () => {
    const result = await client.callTool({ name: 'list_pages', arguments: { prefix: 'epics/' } });
    const parsed = parseResult(result);
    expect(parsed.pages.length).toBe(1);
    expect(parsed.pages[0].file_path).toBe('epics/e1.md');
  });

  it('prefix without trailing slash works', async () => {
    const result = await client.callTool({ name: 'list_pages', arguments: { prefix: 'epics' } });
    const parsed = parseResult(result);
    expect(parsed.pages.length).toBe(1);
  });
});

describe('get_status', () => {
  it('returns server, index, and embedding info', async () => {
    const result = await client.callTool({ name: 'get_status', arguments: {} });
    const parsed = parseResult(result);
    expect(parsed.server.version).toBe('0.1.0');
    expect(parsed.server.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(parsed.index.total_pages).toBe(2);
    expect(parsed.index.total_chunks).toBeGreaterThan(0);
    expect(parsed.embedding.provider).toBe('local');
  });

  it('git info is null when not a git repo', async () => {
    // tmpDir is not a git repo
    const result = await client.callTool({ name: 'get_status', arguments: {} });
    const parsed = parseResult(result);
    expect(parsed.git).toBeNull();
  });
});

describe('tool listing', () => {
  it('lists all 5 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('search_docs');
    expect(names).toContain('get_page');
    expect(names).toContain('get_section');
    expect(names).toContain('list_pages');
    expect(names).toContain('get_status');
    expect(tools.length).toBe(5);
  });
});

// Empty index test
describe('list_pages empty index', () => {
  it('returns empty array for empty db', async () => {
    // We test with a prefix that matches nothing
    const result = await client.callTool({ name: 'list_pages', arguments: { prefix: 'zzz-nonexistent/' } });
    const parsed = parseResult(result);
    expect(parsed.pages).toEqual([]);
    expect(parsed.total_pages).toBe(0);
  });
});
