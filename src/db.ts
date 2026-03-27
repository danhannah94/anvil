import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVss from 'sqlite-vss';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { arch, platform } from 'node:os';
import type { Chunk } from './types.js';

export class AnvilDatabase {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });

    try {
      this.db = new BetterSqlite3(dbPath);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      throw new Error(
        `✗ Failed to open database: ${dbPath}\n` +
        `  ${msg}\n` +
        `  Check that the directory is writable and the file is not locked by another process.`
      );
    }

    this.db.pragma('journal_mode = WAL');

    try {
      sqliteVss.load(this.db);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const plat = platform();
      const cpuArch = arch();
      let platformHint = `  Platform: ${plat} ${cpuArch}`;
      if (plat === 'darwin' && cpuArch === 'arm64') {
        platformHint += ' (Apple Silicon)';
      }
      throw new Error(
        `✗ Failed to load sqlite-vss extension\n` +
        `  ${msg}\n\n` +
        `  This is a native module that needs to be compiled for your platform.\n` +
        `  Try: npm rebuild better-sqlite3\n` +
        platformHint + '\n' +
        `  More info: https://github.com/nicolo-ribaudo/sqlite-vss-node#troubleshooting`
      );
    }

    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT UNIQUE NOT NULL,
        file_path TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        heading_level INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        last_modified TEXT,
        char_count INTEGER,
        ordinal INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS anvil_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vss USING vss0(
        embedding(384)
      );
    `);
  }

  upsertChunk(chunk: Chunk, embedding: Float32Array): void {
    const txn = this.db.transaction(() => {
      // Check if chunk exists
      const existing = this.db.prepare('SELECT id FROM chunks WHERE chunk_id = ?').get(chunk.chunk_id) as { id: number } | undefined;

      if (existing) {
        // Update chunk
        this.db.prepare(`
          UPDATE chunks SET file_path=?, heading_path=?, heading_level=?, content=?, content_hash=?, last_modified=?, char_count=?, ordinal=?
          WHERE chunk_id=?
        `).run(chunk.file_path, chunk.heading_path, chunk.heading_level, chunk.content, chunk.content_hash, chunk.last_modified, chunk.char_count, chunk.ordinal, chunk.chunk_id);

        // Update embedding (vss0 doesn't support UPDATE — delete and re-insert)
        this.db.prepare('DELETE FROM chunks_vss WHERE rowid = ?').run(existing.id);
        this.db.prepare('INSERT INTO chunks_vss (rowid, embedding) VALUES (?, ?)').run(existing.id, embeddingToBuffer(embedding));
      } else {
        // Insert chunk
        const result = this.db.prepare(`
          INSERT INTO chunks (chunk_id, file_path, heading_path, heading_level, content, content_hash, last_modified, char_count, ordinal)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(chunk.chunk_id, chunk.file_path, chunk.heading_path, chunk.heading_level, chunk.content, chunk.content_hash, chunk.last_modified, chunk.char_count, chunk.ordinal);

        // Insert embedding with matching rowid
        this.db.prepare('INSERT INTO chunks_vss (rowid, embedding) VALUES (?, ?)').run(result.lastInsertRowid, embeddingToBuffer(embedding));
      }
    });
    txn();
  }

  deleteChunk(chunkId: string): void {
    const txn = this.db.transaction(() => {
      const row = this.db.prepare('SELECT id FROM chunks WHERE chunk_id = ?').get(chunkId) as { id: number } | undefined;
      if (row) {
        this.db.prepare('DELETE FROM chunks_vss WHERE rowid = ?').run(row.id);
        this.db.prepare('DELETE FROM chunks WHERE id = ?').run(row.id);
      }
    });
    txn();
  }

  deleteFileChunks(filePath: string): void {
    const txn = this.db.transaction(() => {
      const rows = this.db.prepare('SELECT id FROM chunks WHERE file_path = ?').all(filePath) as { id: number }[];
      for (const row of rows) {
        this.db.prepare('DELETE FROM chunks_vss WHERE rowid = ?').run(row.id);
      }
      this.db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);
    });
    txn();
  }

  getChunksByFile(filePath: string): Chunk[] {
    return this.db.prepare('SELECT chunk_id, file_path, heading_path, heading_level, content, content_hash, last_modified, char_count, ordinal FROM chunks WHERE file_path = ? ORDER BY ordinal').all(filePath) as Chunk[];
  }

  getAllChunks(): Chunk[] {
    return this.db.prepare('SELECT chunk_id, file_path, heading_path, heading_level, content, content_hash, last_modified, char_count, ordinal FROM chunks').all() as Chunk[];
  }

  getChunkByHeading(filePath: string, headingPath: string): Chunk | null {
    const row = this.db.prepare('SELECT chunk_id, file_path, heading_path, heading_level, content, content_hash, last_modified, char_count, ordinal FROM chunks WHERE file_path = ? AND heading_path = ?').get(filePath, headingPath) as Chunk | undefined;
    return row ?? null;
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM anvil_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO anvil_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  vectorSearch(embedding: Buffer, limit: number): Array<Chunk & { distance: number }> {
    const rows = this.db.prepare(`
      SELECT c.chunk_id, c.file_path, c.heading_path, c.heading_level, c.content, c.content_hash, c.last_modified, c.char_count, c.ordinal, v.distance
      FROM chunks_vss v
      INNER JOIN chunks c ON c.id = v.rowid
      WHERE vss_search(v.embedding, vss_search_params(?, ?))
    `).all(embedding, limit) as Array<Chunk & { distance: number }>;
    return rows;
  }

  getDistinctFiles(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT file_path FROM chunks ORDER BY file_path').all() as Array<{ file_path: string }>;
    return rows.map(r => r.file_path);
  }

  getChunksByHeadingPrefix(filePath: string, headingPrefix: string): Chunk[] {
    return this.db.prepare(
      'SELECT chunk_id, file_path, heading_path, heading_level, content, content_hash, last_modified, char_count, ordinal FROM chunks WHERE file_path = ? AND (heading_path = ? OR heading_path LIKE ?) ORDER BY ordinal'
    ).all(filePath, headingPrefix, `${headingPrefix} [part %`) as Chunk[];
  }

  close(): void {
    this.db.close();
  }
}

function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}
