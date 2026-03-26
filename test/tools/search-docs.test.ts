import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AnvilDatabase } from '../../src/db.js';
import { Embedder } from '../../src/embedder.js';
import { Indexer } from '../../src/indexer.js';
import { QueryEngine } from '../../src/query.js';
import { registerSearchDocs } from '../../src/tools/search-docs.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let db: AnvilDatabase;
let embedder: Embedder;
let client: Client;
let server: Server;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'anvil-search-tool-'));
  db = new AnvilDatabase(join(tmpDir, 'test.db'));
  embedder = new Embedder();
  await embedder.init();

  const indexer = new Indexer(db, embedder);
  const docsDir = join(tmpDir, 'docs');
  mkdirSync(join(docsDir, 'epics'), { recursive: true });

  writeFileSync(join(docsDir, 'guide.md'), `# Setup Guide\n\nHow to install and configure the system.\n\n## Installation\n\nRun npm install.\n`);
  writeFileSync(join(docsDir, 'epics', 'e1.md'), `# Epic 1\n\nUser authentication feature.\n`);

  await indexer.indexFile('guide.md', String(require('node:fs').readFileSync(join(docsDir, 'guide.md'), 'utf-8')), '2026-01-01T00:00:00Z');
  await indexer.indexFile('epics/e1.md', String(require('node:fs').readFileSync(join(docsDir, 'epics', 'e1.md'), 'utf-8')), '2026-01-01T00:00:00Z');

  const qe = new QueryEngine(db, embedder);

  server = new Server(
    { name: 'anvil-test', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registerSearchDocs(server, qe, async () => {});

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

describe('search_docs tool', () => {
  it('lists search_docs in available tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toContain('search_docs');
  });

  it('returns results for a valid query', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'installation setup' } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0].score).toBeGreaterThan(0);
  });

  it('with top_k limits results', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'guide', top_k: 1 } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.results.length).toBeLessThanOrEqual(1);
  });

  it('with file_filter scopes results', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'authentication', file_filter: 'epics/*' } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    for (const r of parsed.results) {
      expect(r.metadata.file_path).toMatch(/^epics\//);
    }
  });

  it('with empty query returns error', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: '' } });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.error).toBe('query parameter is required');
  });

  it('results include metadata', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'install' } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const r = parsed.results[0];
    expect(r.metadata).toBeDefined();
    expect(r.metadata.file_path).toBeDefined();
    expect(r.metadata.heading_path).toBeDefined();
    expect(r.score).toBeDefined();
    expect(parsed.total_chunks).toBeGreaterThan(0);
    expect(parsed.query_ms).toBeGreaterThanOrEqual(0);
  });
});
