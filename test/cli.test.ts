import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve('dist/cli.js');
const PKG = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    execFile('node', [CLI_PATH, ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      const code = err && 'code' in err ? (err as any).code : 0;
      res({ stdout, stderr, code });
    });
  });
}

describe('CLI', () => {
  describe('--version', () => {
    it('outputs version from package.json', async () => {
      const { stdout } = await runCli(['--version']);
      expect(stdout.trim()).toBe(PKG.version);
    });

    it('also works with -v', async () => {
      const { stdout } = await runCli(['-v']);
      expect(stdout.trim()).toBe(PKG.version);
    });
  });

  describe('--help', () => {
    it('shows help text with subcommands', async () => {
      const { stdout } = await runCli(['--help']);
      expect(stdout).toContain('anvil');
      expect(stdout).toContain('serve');
      expect(stdout).toContain('init');
      expect(stdout).toContain('index');
      expect(stdout).toContain('--docs');
      expect(stdout).toContain('--version');
    });

    it('shows serve-specific help', async () => {
      const { stdout } = await runCli(['serve', '--help']);
      expect(stdout).toContain('--docs');
      expect(stdout).toContain('--no-watch');
    });
  });

  describe('unknown flags', () => {
    it('produces error for unknown flag', async () => {
      const { stderr, code } = await runCli(['--bogus']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('unknown option');
    });
  });

  describe('subcommand stubs', () => {
    it('init prints not-yet-implemented', async () => {
      const { stderr } = await runCli(['init']);
      expect(stderr).toContain('not yet implemented');
    });

    it('index prints not-yet-implemented', async () => {
      const { stderr } = await runCli(['index']);
      expect(stderr).toContain('not yet implemented');
    });
  });

  describe('serve with missing docs', () => {
    it('errors when docs directory does not exist', async () => {
      const { stderr, code } = await runCli(['serve', '--docs', '/nonexistent/path']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('Docs directory not found');
    });

    it('errors when bare command has nonexistent docs', async () => {
      const { stderr, code } = await runCli(['--docs', '/nonexistent/path']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('Docs directory not found');
    });
  });
});
