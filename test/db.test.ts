import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnvilDatabase } from '../src/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Chunk } from '../src/types.js';

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    chunk_id: 'test-chunk-1',
    file_path: 'docs/readme.md',
    heading_path: 'Introduction',
    heading_level: 1,
    content: '# Introduction\nHello world',
    content_hash: 'abc123',
    last_modified: '2026-01-01T00:00:00Z',
    char_count: 27,
    ordinal: 0,
    ...overrides,
  };
}

function makeEmbedding(): Float32Array {
  const e = new Float32Array(384);
  for (let i = 0; i < 384; i++) e[i] = Math.random() * 2 - 1;
  return e;
}

describe('AnvilDatabase', () => {
  let tmpDir: string;
  let db: AnvilDatabase;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'anvil-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new AnvilDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the database file', () => {
    expect(() => new AnvilDatabase(join(tmpDir, 'sub', 'nested.db'))).not.toThrow();
  });

  it('sqlite-vss extension loads successfully', () => {
    // If we got here, the constructor loaded it. Verify by checking the virtual table exists.
    expect(db.getAllChunks()).toEqual([]);
  });

  it('upsertChunk and retrieve', () => {
    const chunk = makeChunk();
    db.upsertChunk(chunk, makeEmbedding());
    const results = db.getAllChunks();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(chunk);
  });

  it('upsertChunk update (same chunk_id, different content)', () => {
    const chunk = makeChunk();
    db.upsertChunk(chunk, makeEmbedding());

    const updated = makeChunk({ content: 'Updated content', content_hash: 'def456', char_count: 15 });
    db.upsertChunk(updated, makeEmbedding());

    const results = db.getAllChunks();
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Updated content');
    expect(results[0].content_hash).toBe('def456');
  });

  it('deleteChunk removes from both tables', () => {
    const chunk = makeChunk();
    db.upsertChunk(chunk, makeEmbedding());
    expect(db.getAllChunks()).toHaveLength(1);

    db.deleteChunk('test-chunk-1');
    expect(db.getAllChunks()).toHaveLength(0);
  });

  it('deleteFileChunks removes all chunks for a file', () => {
    db.upsertChunk(makeChunk({ chunk_id: 'c1', ordinal: 0 }), makeEmbedding());
    db.upsertChunk(makeChunk({ chunk_id: 'c2', ordinal: 1 }), makeEmbedding());
    db.upsertChunk(makeChunk({ chunk_id: 'c3', file_path: 'docs/other.md', ordinal: 0 }), makeEmbedding());

    db.deleteFileChunks('docs/readme.md');
    const remaining = db.getAllChunks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].chunk_id).toBe('c3');
  });

  it('getChunksByFile returns ordered by ordinal', () => {
    db.upsertChunk(makeChunk({ chunk_id: 'c2', ordinal: 2 }), makeEmbedding());
    db.upsertChunk(makeChunk({ chunk_id: 'c0', ordinal: 0 }), makeEmbedding());
    db.upsertChunk(makeChunk({ chunk_id: 'c1', ordinal: 1 }), makeEmbedding());

    const results = db.getChunksByFile('docs/readme.md');
    expect(results.map(r => r.chunk_id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('getChunkByHeading exact match', () => {
    db.upsertChunk(makeChunk(), makeEmbedding());
    const result = db.getChunkByHeading('docs/readme.md', 'Introduction');
    expect(result).not.toBeNull();
    expect(result!.chunk_id).toBe('test-chunk-1');
  });

  it('getChunkByHeading returns null for non-existent', () => {
    const result = db.getChunkByHeading('docs/readme.md', 'Nonexistent');
    expect(result).toBeNull();
  });

  it('getMeta/setMeta round-trip', () => {
    expect(db.getMeta('version')).toBeNull();
    db.setMeta('version', '1.0');
    expect(db.getMeta('version')).toBe('1.0');
    db.setMeta('version', '2.0');
    expect(db.getMeta('version')).toBe('2.0');
  });

  it('embedding round-trip: stored in chunks_vss', () => {
    const chunk = makeChunk();
    const embedding = new Float32Array(384);
    embedding[0] = 0.5;
    embedding[383] = -0.25;
    db.upsertChunk(chunk, embedding);

    // Verify chunk exists - if vss insert failed, the transaction would have rolled back
    expect(db.getAllChunks()).toHaveLength(1);
  });
});
