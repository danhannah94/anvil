import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AnvilDatabase } from '../src/db.js';
import { Embedder } from '../src/embedder.js';
import { Indexer } from '../src/indexer.js';
import { QueryEngine } from '../src/query.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let db: AnvilDatabase;
let embedder: Embedder;
let indexer: Indexer;
let qe: QueryEngine;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'anvil-query-'));
  db = new AnvilDatabase(join(tmpDir, 'test.db'));
  embedder = new Embedder();
  await embedder.init();
  indexer = new Indexer(db, embedder);

  // Create and index fixture files
  const docsDir = join(tmpDir, 'docs');
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(join(docsDir, 'epics'), { recursive: true });

  writeFileSync(join(docsDir, 'guide.md'), `# Getting Started Guide

This is a comprehensive guide to getting started with the project.

## Installation

Run npm install to set up all dependencies.

## Configuration

Create a config file with your API keys and settings.
`);

  writeFileSync(join(docsDir, 'epics', 'epic1.md'), `# Epic 1: User Authentication

Implement user login and registration.

## Requirements

Users must be able to sign up with email and password.

## Technical Design

Use JWT tokens for session management.
`);

  writeFileSync(join(docsDir, 'api.md'), `# API Reference

The complete API reference for the system.

## Endpoints

All endpoints are documented below.

## Authentication

All requests require a Bearer token.
`);

  // Index all files
  for (const [rel, absPath] of [
    ['guide.md', join(docsDir, 'guide.md')],
    ['epics/epic1.md', join(docsDir, 'epics', 'epic1.md')],
    ['api.md', join(docsDir, 'api.md')],
  ] as const) {
    const content = String(require('node:fs').readFileSync(absPath, 'utf-8'));
    await indexer.indexFile(rel, content, '2026-01-15T00:00:00Z');
  }

  qe = new QueryEngine(db, embedder);
}, 60000);

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('QueryEngine.vectorSearch', () => {
  it('returns results ranked by relevance', async () => {
    const { results } = await qe.vectorSearch('authentication login');
    expect(results.length).toBeGreaterThan(0);
    // Scores should be descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns results with correct metadata', async () => {
    const { results } = await qe.vectorSearch('installation setup');
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.content).toBeDefined();
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.metadata.file_path).toBeDefined();
    expect(r.metadata.heading_path).toBeDefined();
    expect(r.metadata.heading_level).toBeGreaterThanOrEqual(1);
    expect(r.metadata.last_modified).toBeDefined();
    expect(r.metadata.char_count).toBeGreaterThan(0);
  });

  it('respects topK limit', async () => {
    const { results } = await qe.vectorSearch('guide', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('with fileFilter only returns matching files', async () => {
    const { results } = await qe.vectorSearch('authentication', 10, 'epics/*');
    for (const r of results) {
      expect(r.metadata.file_path).toMatch(/^epics\//);
    }
  });

  it('returns empty array for no matches with strict filter', async () => {
    const { results } = await qe.vectorSearch('authentication', 5, 'nonexistent/');
    expect(results).toEqual([]);
  });

  it('includes total_chunks and query_ms', async () => {
    const result = await qe.vectorSearch('test');
    expect(result.total_chunks).toBeGreaterThan(0);
    expect(result.query_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('QueryEngine.getPageChunks', () => {
  it('returns all chunks for a file in ordinal order', () => {
    const page = qe.getPageChunks('guide.md');
    expect(page).not.toBeNull();
    expect(page!.file_path).toBe('guide.md');
    expect(page!.title).toBe('Getting Started Guide');
    expect(page!.chunks.length).toBeGreaterThan(0);
    for (let i = 1; i < page!.chunks.length; i++) {
      expect(page!.chunks[i].ordinal).toBeGreaterThanOrEqual(page!.chunks[i - 1].ordinal);
    }
  });

  it('returns null for non-existent file', () => {
    expect(qe.getPageChunks('nope.md')).toBeNull();
  });

  it('has correct total_chars', () => {
    const page = qe.getPageChunks('guide.md')!;
    const sum = page.chunks.reduce((s, c) => s + c.char_count, 0);
    expect(page.total_chars).toBe(sum);
  });
});

describe('QueryEngine.getSectionChunks', () => {
  it('returns correct section by heading path', () => {
    // The chunker keeps small files as one chunk with h1 heading
    const section = qe.getSectionChunks('guide.md', 'Getting Started Guide');
    expect(section).not.toBeNull();
    expect(section!.content).toContain('npm install');
    expect(section!.metadata.file_path).toBe('guide.md');
  });

  it('returns null for non-existent section', () => {
    expect(qe.getSectionChunks('guide.md', 'Nonexistent Section')).toBeNull();
  });

  it('returns null for non-existent file', () => {
    expect(qe.getSectionChunks('nope.md', 'Whatever')).toBeNull();
  });
});

describe('QueryEngine.listPages', () => {
  it('returns all indexed files with metadata', () => {
    const { pages, total_pages } = qe.listPages();
    expect(total_pages).toBe(3);
    expect(pages.map(p => p.file_path).sort()).toEqual(['api.md', 'epics/epic1.md', 'guide.md']);
    for (const p of pages) {
      expect(p.title).toBeDefined();
      expect(p.chunk_count).toBeGreaterThan(0);
      expect(p.total_chars).toBeGreaterThan(0);
      expect(p.last_modified).toBeDefined();
      expect(p.headings.length).toBeGreaterThan(0);
    }
  });

  it('with prefix filter works', () => {
    const { pages, total_pages } = qe.listPages('epics/');
    expect(total_pages).toBe(1);
    expect(pages[0].file_path).toBe('epics/epic1.md');
  });
});
