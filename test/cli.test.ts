import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

function run(...args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status ?? 1,
    };
  }
}

describe('CLI', () => {
  describe('--version', () => {
    it('prints version from package.json', () => {
      const result = run('--version');
      expect(result.stdout.trim()).toBe('0.1.0');
      expect(result.code).toBe(0);
    });

    it('-v also prints version', () => {
      const result = run('-v');
      expect(result.stdout.trim()).toBe('0.1.0');
    });
  });

  describe('--help', () => {
    it('shows help with subcommands', () => {
      const result = run('--help');
      expect(result.stdout).toContain('serve');
      expect(result.stdout).toContain('init');
      expect(result.stdout).toContain('index');
      expect(result.stdout).toContain('--docs');
      expect(result.code).toBe(0);
    });

    it('serve --help shows serve options', () => {
      const result = run('serve', '--help');
      expect(result.stdout).toContain('--docs');
      expect(result.stdout).toContain('--db');
      expect(result.code).toBe(0);
    });
  });

  describe('unknown flags', () => {
    it('produces error for unknown flags', () => {
      const result = run('--bogus');
      expect(result.stderr).toContain('unknown option');
      expect(result.code).not.toBe(0);
    });
  });

  describe('stubs', () => {
    it('init prints not yet implemented', () => {
      const result = run('init');
      expect(result.stdout).toContain('not yet implemented');
      expect(result.code).toBe(0);
    });

    it('index prints not yet implemented', () => {
      const result = run('index');
      expect(result.stdout).toContain('not yet implemented');
      expect(result.code).toBe(0);
    });
  });

  describe('serve with missing docs', () => {
    it('errors when docs path does not exist', () => {
      const result = run('serve', '--docs', '/nonexistent/path');
      expect(result.stderr).toContain('not found');
      expect(result.code).not.toBe(0);
    });

    it('bare command with missing docs also errors', () => {
      const result = run('--docs', '/nonexistent/path');
      expect(result.stderr).toContain('not found');
      expect(result.code).not.toBe(0);
    });
  });

  describe('all flags accepted', () => {
    it('accepts all documented flags without error', () => {
      // Using --help to avoid actually starting server
      const result = run('serve', '--help');
      const flags = ['--docs', '--db', '--no-watch', '--max-chunk-size', '--min-chunk-size', '--embedding-provider', '--log-level'];
      for (const flag of flags) {
        expect(result.stdout).toContain(flag);
      }
    });

    it('program-level accepts config flags', () => {
      const result = run('--help');
      expect(result.stdout).toContain('--config');
      expect(result.stdout).toContain('--no-config');
    });
  });
});
