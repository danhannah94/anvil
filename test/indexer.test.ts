import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Indexer } from '../src/indexer.js';
import { Embedder } from '../src/embedder.js';
import { AnvilDatabase } from '../src/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Each section needs >200 chars to avoid merge
const FILLER_A = 'This is section A content that discusses various aspects of topic A in great detail. We need enough text here to exceed the minimum chunk size threshold of two hundred characters so the chunker does not merge this section with its parent heading.';
const FILLER_B = 'This is section B content that discusses various aspects of topic B in great detail. We need enough text here to exceed the minimum chunk size threshold of two hundred characters so the chunker does not merge this section with its parent heading.';
const FILLER_A2 = 'This is MODIFIED section A content covering entirely different aspects now. The content has been significantly changed from the original version. We need enough text here to exceed the minimum chunk size threshold of two hundred characters to prevent merging.';
const FILLER_C = 'This is section C content that is brand new and discusses topic C comprehensively. We need enough text here to exceed the minimum chunk size threshold of two hundred characters so the chunker does not merge this section with its parent heading.';

const MD_V1 = `# Title

Some intro text here that is long enough to not be merged. This paragraph provides introductory context for the entire document and exceeds two hundred characters comfortably so it stands alone as its own chunk in the system.

## Section A

${FILLER_A}

## Section B

${FILLER_B}
`;

const MD_V2 = `# Title

Some intro text here that is long enough to not be merged. This paragraph provides introductory context for the entire document and exceeds two hundred characters comfortably so it stands alone as its own chunk in the system.

## Section A

${FILLER_A2}

## Section B

${FILLER_B}
`;

const MD_V3 = `# Title

Some intro text here that is long enough to not be merged. This paragraph provides introductory context for the entire document and exceeds two hundred characters comfortably so it stands alone as its own chunk in the system.

## Section A

${FILLER_A2}
`;

const MD_V4 = `# Title

Some intro text here that is long enough to not be merged. This paragraph provides introductory context for the entire document and exceeds two hundred characters comfortably so it stands alone as its own chunk in the system.

## Section A

${FILLER_A2}

## Section B

${FILLER_B}

## Section C

${FILLER_C}
`;

describe('Indexer', () => {
  const embedder = new Embedder();
  let tmpDir: string;
  let db: AnvilDatabase;
  let indexer: Indexer;

  beforeAll(async () => {
    await embedder.init();
  }, 120_000);

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'anvil-test-'));
    db = new AnvilDatabase(join(tmpDir, 'test.db'));
    indexer = new Indexer(db, embedder);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexes a file and chunks appear in DB with embeddings', async () => {
    const stats = await indexer.indexFile('test.md', MD_V1, '2024-01-01');
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBe(0);
    const chunks = db.getChunksByFile('test.md');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('re-indexing unchanged file shows all unchanged', async () => {
    await indexer.indexFile('test.md', MD_V1, '2024-01-01');
    const stats = await indexer.indexFile('test.md', MD_V1, '2024-01-01');
    expect(stats.unchanged).toBeGreaterThan(0);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  it('modified file shows updated chunks', async () => {
    await indexer.indexFile('test.md', MD_V1, '2024-01-01');
    const stats = await indexer.indexFile('test.md', MD_V2, '2024-01-02');
    expect(stats.updated).toBeGreaterThan(0);
  });

  it('deleting a section shows removed chunks', async () => {
    await indexer.indexFile('test.md', MD_V2, '2024-01-01');
    const stats = await indexer.indexFile('test.md', MD_V3, '2024-01-02');
    expect(stats.removed).toBeGreaterThan(0);
  });

  it('adding a section shows added chunks', async () => {
    await indexer.indexFile('test.md', MD_V2, '2024-01-01');
    const stats = await indexer.indexFile('test.md', MD_V4, '2024-01-02');
    expect(stats.added).toBeGreaterThan(0);
  });

  it('model mismatch triggers full re-embed', async () => {
    await indexer.indexFile('test.md', MD_V1, '2024-01-01');
    // Simulate model mismatch
    db.setMeta('embedding_model', 'fake-model');
    db.setMeta('embedding_dimensions', '999');
    const stats = await indexer.indexFile('test.md', MD_V1, '2024-01-01');
    // All chunks should be updated (none unchanged)
    expect(stats.unchanged).toBe(0);
    expect(stats.updated).toBeGreaterThan(0);
  });
});
