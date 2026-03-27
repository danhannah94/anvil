import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProgram } from '../src/cli.js';
import { Command } from 'commander';

function parseArgs(args: string[]): Command {
  const program = createProgram();
  // Prevent commander from calling process.exit on errors
  program.exitOverride();
  // Suppress output during tests
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  // Apply to subcommands too
  for (const cmd of program.commands) {
    cmd.exitOverride();
    cmd.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
  }
  return program;
}

describe('CLI arg parsing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('--version', () => {
    it('outputs version and exits', () => {
      const program = parseArgs([]);
      expect(() => program.parse(['node', 'anvil', '--version'])).toThrow();
    });

    it('-v is alias for --version', () => {
      const program = parseArgs([]);
      expect(() => program.parse(['node', 'anvil', '-v'])).toThrow();
    });
  });

  describe('--help', () => {
    it('exits with help', () => {
      const program = parseArgs([]);
      expect(() => program.parse(['node', 'anvil', '--help'])).toThrow();
    });

    it('-h is alias for --help', () => {
      const program = parseArgs([]);
      expect(() => program.parse(['node', 'anvil', '-h'])).toThrow();
    });
  });

  describe('subcommand routing', () => {
    it('recognizes serve subcommand', () => {
      const program = createProgram();
      const serveCmd = program.commands.find(c => c.name() === 'serve');
      expect(serveCmd).toBeDefined();
      expect(serveCmd!.description()).toContain('MCP server');
    });

    it('recognizes init subcommand', () => {
      const program = createProgram();
      const initCmd = program.commands.find(c => c.name() === 'init');
      expect(initCmd).toBeDefined();
    });

    it('recognizes index subcommand', () => {
      const program = createProgram();
      const indexCmd = program.commands.find(c => c.name() === 'index');
      expect(indexCmd).toBeDefined();
    });
  });

  describe('flag parsing', () => {
    it('parses --docs flag', () => {
      const program = createProgram();
      program.exitOverride();
      // Parse without executing action
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {}); // override action to prevent actual serve
      program.parse(['node', 'anvil', 'serve', '--docs', './my-docs']);
      expect(serveCmd.opts().docs).toBe('./my-docs');
    });

    it('parses -d as alias for --docs', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '-d', './my-docs']);
      expect(serveCmd.opts().docs).toBe('./my-docs');
    });

    it('parses --db flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--db', './my.db']);
      expect(serveCmd.opts().db).toBe('./my.db');
    });

    it('parses --log-level flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--log-level', 'debug']);
      expect(serveCmd.opts().logLevel).toBe('debug');
    });

    it('parses --max-chunk-size flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--max-chunk-size', '8000']);
      expect(serveCmd.opts().maxChunkSize).toBe('8000');
    });

    it('parses --min-chunk-size flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--min-chunk-size', '100']);
      expect(serveCmd.opts().minChunkSize).toBe('100');
    });

    it('parses --embedding-provider flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--embedding-provider', 'openai']);
      expect(serveCmd.opts().embeddingProvider).toBe('openai');
    });

    it('parses --no-watch flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--no-watch']);
      expect(serveCmd.opts().watch).toBe(false);
    });

    it('parses --no-config flag', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '--no-config']);
      expect(serveCmd.opts().config).toBe(false);
    });

    it('parses -c as alias for --config', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve', '-c', './my.config.json']);
      expect(serveCmd.opts().config).toBe('./my.config.json');
    });

    it('defaults docs to ./', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve']);
      expect(serveCmd.opts().docs).toBe('./');
    });

    it('defaults log-level to info', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', 'serve']);
      expect(serveCmd.opts().logLevel).toBe('info');
    });
  });

  describe('unknown flags', () => {
    it('rejects unknown flags on root', () => {
      const program = parseArgs([]);
      expect(() => program.parse(['node', 'anvil', '--bogus'])).toThrow();
    });

    it('rejects unknown flags on serve', () => {
      const program = parseArgs([]);
      expect(() => program.parse(['node', 'anvil', 'serve', '--bogus'])).toThrow();
    });
  });

  describe('bare anvil with flags defaults to serve', () => {
    it('accepts --docs on bare command (routes to serve)', () => {
      const program = createProgram();
      program.exitOverride();
      const serveCmd = program.commands.find(c => c.name() === 'serve')!;
      serveCmd.exitOverride();
      serveCmd.action(() => {});
      program.parse(['node', 'anvil', '--docs', './my-docs']);
      expect(serveCmd.opts().docs).toBe('./my-docs');
    });
  });

  describe('index subcommand flags', () => {
    it('accepts --force flag', () => {
      const program = createProgram();
      program.exitOverride();
      const indexCmd = program.commands.find(c => c.name() === 'index')!;
      indexCmd.exitOverride();
      indexCmd.action(() => {});
      program.parse(['node', 'anvil', 'index', '--force']);
      expect(indexCmd.opts().force).toBe(true);
    });
  });

  describe('init subcommand flags', () => {
    it('accepts --yes flag', () => {
      const program = createProgram();
      program.exitOverride();
      const initCmd = program.commands.find(c => c.name() === 'init')!;
      initCmd.exitOverride();
      initCmd.action(() => {});
      program.parse(['node', 'anvil', 'init', '--yes']);
      expect(initCmd.opts().yes).toBe(true);
    });
  });
});
