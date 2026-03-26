import { watch, type FSWatcher } from 'chokidar';
import { relative } from 'node:path';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private docsRoot: string,
    private onFileChanged: (filePath: string) => Promise<void>,
    private onFileDeleted: (filePath: string) => Promise<void>,
    private debounceMs: number = 300,
  ) {}

  async start(): Promise<void> {
    this.watcher = watch(this.docsRoot, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path: string) => {
        // Allow directories (so we recurse into them)
        // Only allow .md files
        if (path === this.docsRoot) return false;
        // If it has no extension, assume directory — don't ignore
        if (!path.includes('.')) return false;
        return !path.endsWith('.md');
      },
    });

    this.watcher.on('error', (err) => {
      process.stderr.write(`[anvil] Watcher error: ${err}\n`);
    });

    const handleChange = (absPath: string) => {
      if (!absPath.endsWith('.md')) return;
      const rel = relative(this.docsRoot, absPath);
      const existing = this.debounceTimers.get(rel);
      if (existing) clearTimeout(existing);
      this.debounceTimers.set(
        rel,
        setTimeout(() => {
          this.debounceTimers.delete(rel);
          this.onFileChanged(rel).catch((err) =>
            process.stderr.write(`[anvil] Error indexing ${rel}: ${err}\n`),
          );
        }, this.debounceMs),
      );
    };

    this.watcher.on('add', handleChange);
    this.watcher.on('change', handleChange);
    this.watcher.on('unlink', (absPath: string) => {
      if (!absPath.endsWith('.md')) return;
      const rel = relative(this.docsRoot, absPath);
      const existing = this.debounceTimers.get(rel);
      if (existing) {
        clearTimeout(existing);
        this.debounceTimers.delete(rel);
      }
      this.onFileDeleted(rel).catch((err) =>
        process.stderr.write(`[anvil] Error removing ${rel}: ${err}\n`),
      );
    });

    return new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
