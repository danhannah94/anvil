/**
 * Structured stderr logger with log-level support.
 * All output goes to stderr (stdout reserved for MCP stdio).
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

function write(msg: string): void {
  process.stderr.write(msg);
}

export const logger = {
  error(msg: string): void {
    if (shouldLog('error')) write(msg);
  },
  warn(msg: string): void {
    if (shouldLog('warn')) write(msg);
  },
  info(msg: string): void {
    if (shouldLog('info')) write(msg);
  },
  debug(msg: string): void {
    if (shouldLog('debug')) write(msg);
  },
};

/**
 * Format bytes into human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format milliseconds into human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
