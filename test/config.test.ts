import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateConfig,
  discoverConfigPath,
  loadConfigFile,
  mergeConfig,
  resolveConfig,
  DEFAULTS,
} from '../src/config.js';

describe('validateConfig', () => {
  it('accepts a fully valid config', () => {
    const { errors, warnings } = validateConfig({
      docs: './docs', db: './.anvil/index.db',
      embedding: { provider: 'local', model: 'all-MiniLM-L6-v2' },
      chunking: { maxChunkSize: 6000, minChunkSize: 200, mergeShort: true },
      watch: true, logLevel: 'info',
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('accepts an empty config', () => {
    const { errors } = validateConfig({});
    expect(errors).toEqual([]);
  });

  it('accepts a partial config', () => {
    const { errors } = validateConfig({ docs: './my-docs', watch: false });
    expect(errors).toEqual([]);
  });

  it('warns on unknown top-level keys', () => {
    const { errors, warnings } = validateConfig({ foo: 'bar', baz: 123 });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('foo');
  });

  it('warns on unknown embedding keys', () => {
    const { warnings } = validateConfig({ embedding: { provider: 'local', extra: true } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('embedding.extra');
  });

  it('warns on unknown chunking keys', () => {
    const { warnings } = validateConfig({ chunking: { newField: 1 } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('chunking.newField');
  });

  it('errors on wrong type for docs', () => {
    const { errors } = validateConfig({ docs: 123 });
    expect(errors[0]).toContain('"docs" must be a string');
  });

  it('errors on wrong type for watch', () => {
    const { errors } = validateConfig({ watch: 'yes' });
    expect(errors[0]).toContain('"watch" must be a boolean');
  });

  it('errors on invalid logLevel value', () => {
    const { errors } = validateConfig({ logLevel: 'verbose' });
    expect(errors[0]).toContain('verbose');
  });

  it('errors on invalid embedding.provider', () => {
    const { errors } = validateConfig({ embedding: { provider: 'cohere' } });
    expect(errors[0]).toContain('cohere');
  });

  it('errors when embedding is not an object', () => {
    const { errors } = validateConfig({ embedding: 'local' });
    expect(errors[0]).toContain('"embedding" must be an object');
  });

  it('errors when chunking values are wrong type', () => {
    const { errors } = validateConfig({ chunking: { maxChunkSize: '6000', minChunkSize: true, mergeShort: 1 } });
    expect(errors).toHaveLength(3);
  });
});

describe('loadConfigFile', () => {
  const tmpDir = join(tmpdir(), 'anvil-config-test-' + Date.now());
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('loads valid JSON', () => {
    const p = join(tmpDir, 'valid.json');
    writeFileSync(p, JSON.stringify({ docs: './docs' }));
    const { config, errors } = loadConfigFile(p);
    expect(errors).toEqual([]);
    expect(config.docs).toBe('./docs');
  });

  it('returns error for invalid JSON', () => {
    const p = join(tmpDir, 'bad.json');
    writeFileSync(p, '{ not json }');
    const { errors } = loadConfigFile(p);
    expect(errors[0]).toContain('Invalid JSON');
  });

  it('returns error for non-object JSON', () => {
    const p = join(tmpDir, 'array.json');
    writeFileSync(p, '[1,2,3]');
    const { errors } = loadConfigFile(p);
    expect(errors[0]).toContain('JSON object');
  });
});

describe('discoverConfigPath', () => {
  const tmpDir = join(tmpdir(), 'anvil-discover-test-' + Date.now());
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns null when --no-config', () => {
    expect(discoverConfigPath({ config: false })).toBeNull();
  });

  it('returns explicit path if it exists', () => {
    const p = join(tmpDir, 'custom.json');
    writeFileSync(p, '{}');
    expect(discoverConfigPath({ config: p })).toBe(p);
  });

  it('returns null for explicit path that does not exist', () => {
    expect(discoverConfigPath({ config: join(tmpDir, 'nope.json') })).toBeNull();
  });

  it('finds anvil.config.json in docs directory', () => {
    const docsDir = join(tmpDir, 'docs');
    mkdirSync(docsDir, { recursive: true });
    const p = join(docsDir, 'anvil.config.json');
    writeFileSync(p, '{}');
    expect(discoverConfigPath({ docs: docsDir })).toBe(p);
  });

  it('returns null when no config found anywhere', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      expect(discoverConfigPath({ docs: join(tmpDir, 'nonexistent') })).toBeNull();
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('mergeConfig', () => {
  it('uses defaults when no config or CLI flags', () => {
    const result = mergeConfig({}, {}, new Set());
    expect(result).toEqual(DEFAULTS);
  });

  it('config file overrides defaults', () => {
    const result = mergeConfig({ docs: './custom', logLevel: 'debug' }, {}, new Set());
    expect(result.docs).toBe('./custom');
    expect(result.logLevel).toBe('debug');
    expect(result.chunking.maxChunkSize).toBe(6000);
  });

  it('CLI flags override config file', () => {
    const result = mergeConfig(
      { docs: './from-config', logLevel: 'debug' },
      { docs: './from-cli', logLevel: 'warn' },
      new Set(['docs', 'logLevel']),
    );
    expect(result.docs).toBe('./from-cli');
    expect(result.logLevel).toBe('warn');
  });

  it('non-explicit CLI flags do NOT override config', () => {
    const result = mergeConfig(
      { docs: './from-config' },
      { docs: './' },
      new Set(),
    );
    expect(result.docs).toBe('./from-config');
  });

  it('merges nested chunking from config', () => {
    const result = mergeConfig({ chunking: { maxChunkSize: 8000 } }, {}, new Set());
    expect(result.chunking.maxChunkSize).toBe(8000);
    expect(result.chunking.minChunkSize).toBe(200);
  });

  it('CLI maxChunkSize overrides config chunking', () => {
    const result = mergeConfig(
      { chunking: { maxChunkSize: 8000 } },
      { maxChunkSize: '10000' },
      new Set(['maxChunkSize']),
    );
    expect(result.chunking.maxChunkSize).toBe(10000);
  });

  it('merges embedding from config', () => {
    const result = mergeConfig({ embedding: { provider: 'openai', model: 'text-embedding-3-small' } }, {}, new Set());
    expect(result.embedding.provider).toBe('openai');
    expect(result.embedding.model).toBe('text-embedding-3-small');
  });
});

describe('resolveConfig (integration)', () => {
  const tmpDir = join(tmpdir(), 'anvil-resolve-test-' + Date.now());
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns defaults when --no-config', () => {
    const { config, configPath } = resolveConfig({ config: false }, new Set());
    expect(configPath).toBeNull();
    expect(config).toEqual(DEFAULTS);
  });

  it('loads config file and merges with defaults', () => {
    const p = join(tmpDir, 'anvil.config.json');
    writeFileSync(p, JSON.stringify({ docs: './my-docs', watch: false }));
    const { config, configPath } = resolveConfig({ config: p }, new Set());
    expect(configPath).toBe(p);
    expect(config.docs).toBe('./my-docs');
    expect(config.watch).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('CLI flags override config file values', () => {
    const p = join(tmpDir, 'anvil.config.json');
    writeFileSync(p, JSON.stringify({ docs: './from-config', logLevel: 'debug' }));
    const { config } = resolveConfig(
      { config: p, docs: './from-cli', logLevel: 'error' },
      new Set(['docs', 'logLevel']),
    );
    expect(config.docs).toBe('./from-cli');
    expect(config.logLevel).toBe('error');
  });

  it('throws on invalid config file', () => {
    const p = join(tmpDir, 'anvil.config.json');
    writeFileSync(p, JSON.stringify({ logLevel: 'verbose' }));
    expect(() => resolveConfig({ config: p }, new Set())).toThrow(/verbose/);
  });

  it('throws on malformed JSON', () => {
    const p = join(tmpDir, 'anvil.config.json');
    writeFileSync(p, '{ broken');
    expect(() => resolveConfig({ config: p }, new Set())).toThrow(/Invalid JSON/);
  });

  it('returns warnings for unknown keys', () => {
    const p = join(tmpDir, 'anvil.config.json');
    writeFileSync(p, JSON.stringify({ docs: './docs', futureFeature: true }));
    const { warnings } = resolveConfig({ config: p }, new Set());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('futureFeature');
  });
});
