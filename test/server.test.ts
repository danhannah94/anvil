import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { AnvilServer } from '../src/server.js';
import { mkdtempSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeTmpDocs(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'anvil-server-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

describe('AnvilServer', () => {
  let server: AnvilServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and creates DB', async () => {
    const dir = makeTmpDocs({ 'hello.md': '# Hello\nWorld' });
    server = new AnvilServer({ docsRoot: dir, watch: false });
    await server.start();
    const db = server.getDatabase();
    expect(db).toBeDefined();
    const chunks = db.getAllChunks();
    expect(chunks.length).toBeGreaterThan(0);
  }, 60000);

  it('indexes all .md files on startup', async () => {
    const dir = makeTmpDocs({
      'a.md': '# Alpha\nContent A',
      'b.md': '# Beta\nContent B',
      'sub/c.md': '# Charlie\nContent C',
    });
    server = new AnvilServer({ docsRoot: dir, watch: false });
    await server.start();
    const db = server.getDatabase();
    const files = new Set(db.getAllChunks().map((c) => c.file_path));
    expect(files.has('a.md')).toBe(true);
    expect(files.has('b.md')).toBe(true);
    expect(files.has(join('sub', 'c.md'))).toBe(true);
  }, 60000);

  it('prunes deleted files on startup', async () => {
    const dir = makeTmpDocs({
      'keep.md': '# Keep\nKeep this',
      'remove.md': '# Remove\nRemove this',
    });
    // First run indexes both
    server = new AnvilServer({ docsRoot: dir, watch: false });
    await server.start();
    await server.stop();

    // Delete one file
    unlinkSync(join(dir, 'remove.md'));

    // Second run should prune
    server = new AnvilServer({ docsRoot: dir, dbPath: join(dir, '.anvil', 'index.db'), watch: false });
    await server.start();
    const db = server.getDatabase();
    const files = new Set(db.getAllChunks().map((c) => c.file_path));
    expect(files.has('keep.md')).toBe(true);
    expect(files.has('remove.md')).toBe(false);
  }, 60000);

  it('checkStaleness re-indexes modified files', async () => {
    const dir = makeTmpDocs({ 'doc.md': '# Original\nOriginal content' });
    server = new AnvilServer({ docsRoot: dir, watch: false });
    await server.start();

    // Wait a bit then modify
    await sleep(100);
    writeFileSync(join(dir, 'doc.md'), '# Updated\nUpdated content');

    await server.checkStaleness();
    const db = server.getDatabase();
    const chunks = db.getChunksByFile('doc.md');
    expect(chunks.some((c) => c.content.includes('Updated'))).toBe(true);
  }, 60000);

  it('checkStaleness detects new files', async () => {
    const dir = makeTmpDocs({ 'existing.md': '# Existing\nContent' });
    server = new AnvilServer({ docsRoot: dir, watch: false });
    await server.start();

    writeFileSync(join(dir, 'new.md'), '# New\nNew content');
    await server.checkStaleness();
    const db = server.getDatabase();
    const files = new Set(db.getAllChunks().map((c) => c.file_path));
    expect(files.has('new.md')).toBe(true);
  }, 60000);

  it('shuts down gracefully', async () => {
    const dir = makeTmpDocs({ 'test.md': '# Test\nContent' });
    server = new AnvilServer({ docsRoot: dir, watch: true });
    await server.start();
    await server.stop();
    // Double stop should be safe
    await server.stop();
    server = null; // prevent afterEach double-stop
  }, 60000);
});
