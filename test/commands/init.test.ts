import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit } from '../../src/commands/init.js';
import { resolveConfig } from '../../src/config.js';
import { Writable } from 'node:stream';

function createNullOutput(): Writable {
  return new Writable({ write(_chunk, _enc, cb) { cb(); } });
}

describe('anvil init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `anvil-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates valid anvil.config.json with --yes', async () => {
    await runInit({ yes: true, outDir: tmpDir, output: createNullOutput() });

    const configPath = join(tmpDir, 'anvil.config.json');
    expect(existsSync(configPath)).toBe(true);

    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(raw.docs).toBe('./');
    expect(raw.embedding.provider).toBe('local');
    expect(raw.chunking.maxChunkSize).toBe(6000);
  });

  it('creates config loadable by resolveConfig', async () => {
    await runInit({ yes: true, outDir: tmpDir, output: createNullOutput() });

    const configPath = join(tmpDir, 'anvil.config.json');
    // resolveConfig should accept this file
    const result = resolveConfig(
      { config: configPath },
      new Set<string>(['config']),
    );
    expect(result.config.docs).toBe('./');
    expect(result.config.embedding.provider).toBe('local');
    expect(result.warnings).toEqual([]);
  });

  it('--yes overwrites existing config without prompting', async () => {
    const configPath = join(tmpDir, 'anvil.config.json');
    writeFileSync(configPath, JSON.stringify({ docs: './old' }));

    await runInit({ yes: true, outDir: tmpDir, output: createNullOutput() });

    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(raw.docs).toBe('./');
  });
});
