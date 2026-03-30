import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// --- Types ---

export interface AnvilConfig {
  docs: string;
  db: string;
  embedding: {
    provider: 'local' | 'openai';
    model: string;
    apiKey?: string;
  };
  chunking: {
    maxChunkSize: number;
    minChunkSize: number;
    mergeShort: boolean;
  };
  watch: boolean;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

export const DEFAULTS: AnvilConfig = {
  docs: './',
  db: './.anvil/index.db',
  embedding: {
    provider: 'local',
    model: 'all-MiniLM-L6-v2',
  },
  chunking: {
    maxChunkSize: 6000,
    minChunkSize: 200,
    mergeShort: true,
  },
  watch: true,
  logLevel: 'info',
};

const VALID_LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;
const VALID_PROVIDERS = ['local', 'openai'] as const;

// --- Validation ---

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateConfig(raw: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const knownTopKeys = new Set(['docs', 'db', 'embedding', 'chunking', 'watch', 'logLevel']);
  const knownEmbeddingKeys = new Set(['provider', 'model', 'apiKey']);
  const knownChunkingKeys = new Set(['maxChunkSize', 'minChunkSize', 'mergeShort']);

  for (const key of Object.keys(raw)) {
    if (!knownTopKeys.has(key)) {
      warnings.push(`Unknown config key "${key}" — ignoring`);
    }
  }

  if ('docs' in raw && typeof raw.docs !== 'string') {
    errors.push(`"docs" must be a string, got ${typeof raw.docs}`);
  }
  if ('db' in raw && typeof raw.db !== 'string') {
    errors.push(`"db" must be a string, got ${typeof raw.db}`);
  }
  if ('watch' in raw && typeof raw.watch !== 'boolean') {
    errors.push(`"watch" must be a boolean, got ${typeof raw.watch}`);
  }

  if ('logLevel' in raw) {
    if (typeof raw.logLevel !== 'string') {
      errors.push(`"logLevel" must be a string, got ${typeof raw.logLevel}`);
    } else if (!(VALID_LOG_LEVELS as readonly string[]).includes(raw.logLevel)) {
      errors.push(`"logLevel" must be one of ${VALID_LOG_LEVELS.join(', ')} — got "${raw.logLevel}"`);
    }
  }

  if ('embedding' in raw) {
    if (typeof raw.embedding !== 'object' || raw.embedding === null || Array.isArray(raw.embedding)) {
      errors.push(`"embedding" must be an object`);
    } else {
      const emb = raw.embedding as Record<string, unknown>;
      for (const key of Object.keys(emb)) {
        if (!knownEmbeddingKeys.has(key)) {
          warnings.push(`Unknown config key "embedding.${key}" — ignoring`);
        }
      }
      if ('provider' in emb) {
        if (typeof emb.provider !== 'string') {
          errors.push(`"embedding.provider" must be a string, got ${typeof emb.provider}`);
        } else if (!(VALID_PROVIDERS as readonly string[]).includes(emb.provider)) {
          errors.push(`"embedding.provider" must be one of ${VALID_PROVIDERS.join(', ')} — got "${emb.provider}"`);
        }
      }
      if ('model' in emb && typeof emb.model !== 'string') {
        errors.push(`"embedding.model" must be a string, got ${typeof emb.model}`);
      }
      if ('apiKey' in emb && typeof emb.apiKey !== 'string') {
        errors.push(`"embedding.apiKey" must be a string, got ${typeof emb.apiKey}`);
      }
    }
  }

  if ('chunking' in raw) {
    if (typeof raw.chunking !== 'object' || raw.chunking === null || Array.isArray(raw.chunking)) {
      errors.push(`"chunking" must be an object`);
    } else {
      const ch = raw.chunking as Record<string, unknown>;
      for (const key of Object.keys(ch)) {
        if (!knownChunkingKeys.has(key)) {
          warnings.push(`Unknown config key "chunking.${key}" — ignoring`);
        }
      }
      if ('maxChunkSize' in ch && typeof ch.maxChunkSize !== 'number') {
        errors.push(`"chunking.maxChunkSize" must be a number, got ${typeof ch.maxChunkSize}`);
      }
      if ('minChunkSize' in ch && typeof ch.minChunkSize !== 'number') {
        errors.push(`"chunking.minChunkSize" must be a number, got ${typeof ch.minChunkSize}`);
      }
      if ('mergeShort' in ch && typeof ch.mergeShort !== 'boolean') {
        errors.push(`"chunking.mergeShort" must be a boolean, got ${typeof ch.mergeShort}`);
      }
    }
  }

  return { errors, warnings };
}

// --- Discovery ---

export function discoverConfigPath(opts: { config?: string | false; docs?: string }): string | null {
  if (opts.config === false) return null;

  if (typeof opts.config === 'string') {
    const p = resolve(opts.config);
    if (existsSync(p)) return p;
    return null;
  }

  const cwdPath = resolve('anvil.config.json');
  if (existsSync(cwdPath)) return cwdPath;

  if (opts.docs) {
    const docsPath = resolve(opts.docs, 'anvil.config.json');
    if (existsSync(docsPath)) return docsPath;
  }

  return null;
}

// --- Loading ---

export function loadConfigFile(filePath: string): { config: Record<string, unknown>; errors: string[] } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { config: {}, errors: ['Config file must contain a JSON object'] };
    }
    return { config: parsed as Record<string, unknown>, errors: [] };
  } catch (err) {
    const msg = err instanceof SyntaxError
      ? `Invalid JSON in config file: ${err.message}`
      : `Failed to read config file: ${(err as Error).message}`;
    return { config: {}, errors: [msg] };
  }
}

// --- Merge ---

export interface CLIFlags {
  docs?: string;
  db?: string;
  watch?: boolean;
  config?: string | false;
  maxChunkSize?: string;
  minChunkSize?: string;
  embeddingProvider?: string;
  logLevel?: string;
}

export function mergeConfig(
  fileConfig: Record<string, unknown>,
  cliFlags: CLIFlags,
  cliExplicit: Set<string>,
): AnvilConfig {
  const result: AnvilConfig = structuredClone(DEFAULTS);

  // Layer config file
  if (typeof fileConfig.docs === 'string') result.docs = fileConfig.docs;
  if (typeof fileConfig.db === 'string') result.db = fileConfig.db;
  if (typeof fileConfig.watch === 'boolean') result.watch = fileConfig.watch;
  if (typeof fileConfig.logLevel === 'string' && (VALID_LOG_LEVELS as readonly string[]).includes(fileConfig.logLevel)) {
    result.logLevel = fileConfig.logLevel as AnvilConfig['logLevel'];
  }

  if (typeof fileConfig.embedding === 'object' && fileConfig.embedding !== null) {
    const emb = fileConfig.embedding as Record<string, unknown>;
    if (typeof emb.provider === 'string' && (VALID_PROVIDERS as readonly string[]).includes(emb.provider)) {
      result.embedding.provider = emb.provider as AnvilConfig['embedding']['provider'];
    }
    if (typeof emb.model === 'string') result.embedding.model = emb.model;
    if (typeof emb.apiKey === 'string') result.embedding.apiKey = emb.apiKey;
  }

  if (typeof fileConfig.chunking === 'object' && fileConfig.chunking !== null) {
    const ch = fileConfig.chunking as Record<string, unknown>;
    if (typeof ch.maxChunkSize === 'number') result.chunking.maxChunkSize = ch.maxChunkSize;
    if (typeof ch.minChunkSize === 'number') result.chunking.minChunkSize = ch.minChunkSize;
    if (typeof ch.mergeShort === 'boolean') result.chunking.mergeShort = ch.mergeShort;
  }

  // Layer CLI flags (only explicit)
  if (cliExplicit.has('docs') && cliFlags.docs) result.docs = cliFlags.docs;
  if (cliExplicit.has('db') && cliFlags.db) result.db = cliFlags.db;
  if (cliExplicit.has('watch') && typeof cliFlags.watch === 'boolean') result.watch = cliFlags.watch;
  if (cliExplicit.has('logLevel') && cliFlags.logLevel &&
      (VALID_LOG_LEVELS as readonly string[]).includes(cliFlags.logLevel)) {
    result.logLevel = cliFlags.logLevel as AnvilConfig['logLevel'];
  }
  if (cliExplicit.has('embeddingProvider') && cliFlags.embeddingProvider &&
      (VALID_PROVIDERS as readonly string[]).includes(cliFlags.embeddingProvider)) {
    result.embedding.provider = cliFlags.embeddingProvider as AnvilConfig['embedding']['provider'];
  }
  if (cliExplicit.has('maxChunkSize') && cliFlags.maxChunkSize) {
    result.chunking.maxChunkSize = parseInt(cliFlags.maxChunkSize, 10);
  }
  if (cliExplicit.has('minChunkSize') && cliFlags.minChunkSize) {
    result.chunking.minChunkSize = parseInt(cliFlags.minChunkSize, 10);
  }

  return result;
}

// --- Resolve Config (top-level orchestrator) ---

export interface ResolveConfigResult {
  config: AnvilConfig;
  configPath: string | null;
  warnings: string[];
}

export function resolveConfig(cliFlags: CLIFlags, cliExplicit: Set<string>): ResolveConfigResult {
  const warnings: string[] = [];

  if (cliFlags.config === false) {
    return {
      config: mergeConfig({}, cliFlags, cliExplicit),
      configPath: null,
      warnings,
    };
  }

  const configPath = discoverConfigPath({ config: cliFlags.config, docs: cliFlags.docs });

  if (!configPath) {
    return {
      config: mergeConfig({}, cliFlags, cliExplicit),
      configPath: null,
      warnings,
    };
  }

  const { config: rawConfig, errors: loadErrors } = loadConfigFile(configPath);

  if (loadErrors.length > 0) {
    throw new Error(
      `✗ Could not load config file: ${configPath}\n` +
      loadErrors.map(e => `  ${e}`).join('\n') + '\n' +
      `  Check that the file contains valid JSON.`
    );
  }

  const validation = validateConfig(rawConfig);

  if (validation.warnings.length > 0) {
    warnings.push(
      `⚠ Config file has unknown keys (ignored): ${validation.warnings.map(w => w.replace(/^Unknown config key "([^"]+)".*/, '$1')).join(', ')}\n` +
      `  This may be a typo or a setting from a newer version of Anvil.`
    );
  }

  if (validation.errors.length > 0) {
    throw new Error(
      `✗ Config file has invalid values:\n` +
      validation.errors.map(e => `  • ${e}`).join('\n')
    );
  }

  return {
    config: mergeConfig(rawConfig, cliFlags, cliExplicit),
    configPath,
    warnings,
  };
}
