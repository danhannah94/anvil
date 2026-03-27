import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runIndex } from '../../src/commands/index.js';
import { AnvilDatabase } from '../../src/db.js';

const TEST_DIR = join(import.meta.dirname, '..', '.tmp-index-test');
const DOCS_DIR = join(TEST_DIR, 'docs');
const DB_PATH = join(TEST_DIR, 'test.db');

function setupFixtures(): void {
  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(join(DOCS_DIR, 'page1.md'), '# Hello\n\nThis is page one with enough content to be indexed properly.\n');
  writeFileSync(join(DOCS_DIR, 'page2.md'), '# World\n\nThis is page two with some different content for testing.\n');
}

describe('anvil index command', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    setupFixtures();
    // Suppress process.exit
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('indexes docs and creates DB', async () => {
    await runIndex({
      docs: DOCS_DIR,
      db: DB_PATH,
      logLevel: 'silent',
    });

    expect(existsSync(DB_PATH)).toBe(true);

    const db = new AnvilDatabase(DB_PATH);
    const chunks = db.getAllChunks();
    expect(chunks.length).toBeGreaterThan(0);

    const files = db.getDistinctFiles();
    expect(files).toContain('page1.md');
    expect(files).toContain('page2.md');
    db.close();
  });

  it('--force re-embeds all chunks', async () => {
    // First index
    await runIndex({
      docs: DOCS_DIR,
      db: DB_PATH,
      logLevel: 'silent',
    });

    const db1 = new AnvilDatabase(DB_PATH);
    const firstMeta = db1.getMeta('last_index_timestamp');
    db1.close();

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 50));

    // Force re-index
    await runIndex({
      docs: DOCS_DIR,
      db: DB_PATH,
      force: true,
      logLevel: 'silent',
    });

    const db2 = new AnvilDatabase(DB_PATH);
    const secondMeta = db2.getMeta('last_index_timestamp');
    expect(secondMeta).not.toBe(firstMeta);

    const chunks = db2.getAllChunks();
    expect(chunks.length).toBeGreaterThan(0);
    db2.close();
  });

  it('exits with error for missing docs dir', async () => {
    await expect(
      runIndex({
        docs: '/nonexistent/path',
        logLevel: 'silent',
      }),
    ).rejects.toThrow('process.exit called');
  });

  it('handles empty docs directory', async () => {
    const emptyDir = join(TEST_DIR, 'empty');
    mkdirSync(emptyDir, { recursive: true });

    await runIndex({
      docs: emptyDir,
      db: join(TEST_DIR, 'empty.db'),
      logLevel: 'silent',
    });
    // Should complete without error (0 files)
  });

  it('outputs to stderr not stdout', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write');
    const stdoutSpy = vi.spyOn(process.stdout, 'write');

    await runIndex({
      docs: DOCS_DIR,
      db: DB_PATH,
      logLevel: 'info',
    });

    // stderr should have output
    expect(stderrSpy).toHaveBeenCalled();

    // stdout should NOT have index output
    const stdoutCalls = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('Index') || s.includes('anvil'));
    expect(stdoutCalls).toHaveLength(0);
  });

  it('--log-level silent suppresses non-error output', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write');

    await runIndex({
      docs: DOCS_DIR,
      db: DB_PATH,
      logLevel: 'silent',
    });

    // Only embedder init writes directly to stderr (not through logger)
    // Our logger.info calls should be suppressed
    const loggerCalls = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('🔨') || s.includes('✅'));
    expect(loggerCalls).toHaveLength(0);
  });
});
