import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULTS, validateConfig, type AnvilConfig } from '../config.js';

const CONFIG_FILENAME = 'anvil.config.json';

interface InitOptions {
  yes?: boolean;
  /** Override output path (for testing) */
  outDir?: string;
  /** Override stdin/stdout (for testing) */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

function configToJSON(config: AnvilConfig): string {
  return JSON.stringify(config, null, 2) + '\n';
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: string,
): Promise<string> {
  return new Promise((res) => {
    rl.question(`${question} (${defaultValue}): `, (answer) => {
      res(answer.trim() || defaultValue);
    });
  });
}

function diffConfigs(existing: Record<string, unknown>, newConfig: AnvilConfig): string[] {
  const diffs: string[] = [];
  const existingStr = JSON.stringify(existing, null, 2).split('\n');
  const newStr = JSON.stringify(newConfig, null, 2).split('\n');

  const maxLen = Math.max(existingStr.length, newStr.length);
  for (let i = 0; i < maxLen; i++) {
    const a = existingStr[i] ?? '';
    const b = newStr[i] ?? '';
    if (a !== b) {
      if (a) diffs.push(`- ${a}`);
      if (b) diffs.push(`+ ${b}`);
    }
  }
  return diffs;
}

export async function runInit(opts: InitOptions = {}): Promise<void> {
  const dir = opts.outDir ?? process.cwd();
  const configPath = resolve(dir, CONFIG_FILENAME);
  const out = opts.output ?? process.stderr;
  const write = (msg: string) => out.write(msg);

  let config: AnvilConfig;

  if (opts.yes) {
    // Use all defaults, no prompts
    config = structuredClone(DEFAULTS);
  } else {
    const rl = createInterface({
      input: opts.input ?? process.stdin,
      output: opts.output ?? process.stderr,
    });

    try {
      write('\n🔨 Anvil Init\n\n');

      const docs = await ask(rl, 'Docs directory', DEFAULTS.docs);
      const provider = await ask(rl, 'Embedding provider (local/openai)', DEFAULTS.embedding.provider);
      const model = await ask(rl, 'Embedding model', DEFAULTS.embedding.model);
      const maxChunkSize = await ask(rl, 'Max chunk size', String(DEFAULTS.chunking.maxChunkSize));
      const minChunkSize = await ask(rl, 'Min chunk size', String(DEFAULTS.chunking.minChunkSize));
      const logLevel = await ask(rl, 'Log level (silent/error/warn/info/debug)', DEFAULTS.logLevel);

      config = {
        docs,
        db: DEFAULTS.db,
        embedding: {
          provider: provider as AnvilConfig['embedding']['provider'],
          model,
        },
        chunking: {
          maxChunkSize: parseInt(maxChunkSize, 10) || DEFAULTS.chunking.maxChunkSize,
          minChunkSize: parseInt(minChunkSize, 10) || DEFAULTS.chunking.minChunkSize,
          mergeShort: DEFAULTS.chunking.mergeShort,
        },
        watch: DEFAULTS.watch,
        logLevel: logLevel as AnvilConfig['logLevel'],
      };

      // Check if file exists and prompt to overwrite
      if (existsSync(configPath)) {
        try {
          const existing = JSON.parse(readFileSync(configPath, 'utf-8'));
          const diffs = diffConfigs(existing, config);
          if (diffs.length > 0) {
            write('\nExisting config differs:\n');
            for (const d of diffs) write(`  ${d}\n`);
          } else {
            write('\nExisting config is identical.\n');
          }
        } catch {
          // Can't parse existing — just note it
          write('\nExisting config file found (could not parse for diff).\n');
        }

        const overwrite = await ask(rl, 'Overwrite?', 'no');
        if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
          write('Aborted.\n');
          rl.close();
          return;
        }
      }

      rl.close();
    } catch {
      rl.close();
      throw new Error('Init cancelled');
    }
  }

  // Validate before writing
  const validation = validateConfig(config as unknown as Record<string, unknown>);
  if (validation.errors.length > 0) {
    throw new Error(`Generated invalid config:\n${validation.errors.join('\n')}`);
  }

  // Write config
  writeFileSync(configPath, configToJSON(config));
  write(`\n✅ Created ${configPath}\n`);

  // Next steps
  write(`
Next steps:
  1. Add docs to your docs directory:
     mkdir -p ${config.docs === './' ? './docs' : config.docs}

  2. Start the MCP server:
     anvil serve

  3. Or index first, then serve:
     anvil index
     anvil serve
\n`);
}
