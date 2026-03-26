import { describe, it, expect, afterEach } from 'vitest';
import { FileWatcher } from '../src/watcher.js';
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('FileWatcher', () => {
  let watcher: FileWatcher | null = null;
  let tmpDir: string;

  function makeTmp() {
    tmpDir = mkdtempSync(join(tmpdir(), 'anvil-watcher-'));
    return tmpDir;
  }

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
  });

  it('detects new .md file', async () => {
    const dir = makeTmp();
    const changed: string[] = [];
    watcher = new FileWatcher(dir, async (p) => { changed.push(p); }, async () => {}, 50);
    await watcher.start();

    writeFileSync(join(dir, 'test.md'), '# Hello');
    await sleep(600);
    expect(changed).toContain('test.md');
  });

  it('detects modified .md file', async () => {
    const dir = makeTmp();
    writeFileSync(join(dir, 'existing.md'), '# Old');
    const changed: string[] = [];
    watcher = new FileWatcher(dir, async (p) => { changed.push(p); }, async () => {}, 50);
    await watcher.start();

    writeFileSync(join(dir, 'existing.md'), '# New');
    await sleep(600);
    expect(changed).toContain('existing.md');
  });

  it('detects deleted .md file', async () => {
    const dir = makeTmp();
    writeFileSync(join(dir, 'todelete.md'), '# Delete me');
    const deleted: string[] = [];
    watcher = new FileWatcher(dir, async () => {}, async (p) => { deleted.push(p); }, 50);
    await watcher.start();

    unlinkSync(join(dir, 'todelete.md'));
    await sleep(600);
    expect(deleted).toContain('todelete.md');
  });

  it('ignores non-.md files', async () => {
    const dir = makeTmp();
    const changed: string[] = [];
    watcher = new FileWatcher(dir, async (p) => { changed.push(p); }, async () => {}, 50);
    await watcher.start();

    writeFileSync(join(dir, 'test.txt'), 'hello');
    await sleep(600);
    expect(changed).toHaveLength(0);
  });

  it('provides paths relative to docsRoot', async () => {
    const dir = makeTmp();
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const changed: string[] = [];
    watcher = new FileWatcher(dir, async (p) => { changed.push(p); }, async () => {}, 50);
    await watcher.start();

    writeFileSync(join(dir, 'sub', 'nested.md'), '# Nested');
    await sleep(600);
    expect(changed).toContain(join('sub', 'nested.md'));
  });

  it('debounces rapid writes', async () => {
    const dir = makeTmp();
    const changed: string[] = [];
    watcher = new FileWatcher(dir, async (p) => { changed.push(p); }, async () => {}, 200);
    await watcher.start();

    writeFileSync(join(dir, 'rapid.md'), 'v1');
    await sleep(50);
    writeFileSync(join(dir, 'rapid.md'), 'v2');
    await sleep(50);
    writeFileSync(join(dir, 'rapid.md'), 'v3');
    await sleep(600);
    // Should have been debounced to 1-2 calls, not 3
    expect(changed.filter((p) => p === 'rapid.md').length).toBeLessThanOrEqual(2);
  });
});
