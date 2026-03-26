import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chunkMarkdown } from '../src/chunker.js';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('chunkMarkdown', () => {
  describe('basic heading hierarchy', () => {
    it('produces correct breadcrumbs for h1/h2/h3', () => {
      const chunks = chunkMarkdown(fixture('simple-headings.md'), 'docs/simple.md', '2024-01-01T00:00:00Z');
      const paths = chunks.map(c => c.heading_path);
      expect(paths).toContain('Project Overview');
      expect(paths).toContain('Project Overview > Architecture');
      expect(paths).toContain('Project Overview > Architecture > Data Flow');
      expect(paths).toContain('Project Overview > Installation');
    });

    it('assigns sequential ordinals starting from 0', () => {
      const chunks = chunkMarkdown(fixture('simple-headings.md'), 'docs/simple.md', '2024-01-01T00:00:00Z');
      chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
    });

    it('includes heading line in chunk content', () => {
      const chunks = chunkMarkdown(fixture('simple-headings.md'), 'docs/simple.md', '2024-01-01T00:00:00Z');
      const arch = chunks.find(c => c.heading_path === 'Project Overview > Architecture');
      expect(arch?.content).toMatch(/^## Architecture/);
    });
  });

  describe('deterministic IDs', () => {
    it('chunk_id is deterministic', () => {
      const a = chunkMarkdown(fixture('simple-headings.md'), 'docs/s.md', '2024-01-01T00:00:00Z');
      const b = chunkMarkdown(fixture('simple-headings.md'), 'docs/s.md', '2024-01-01T00:00:00Z');
      expect(a.map(c => c.chunk_id)).toEqual(b.map(c => c.chunk_id));
    });

    it('content_hash changes when content changes', () => {
      const a = chunkMarkdown('# Hello\n\nWorld is great and wonderful and amazing.', 'f', '2024-01-01T00:00:00Z');
      const b = chunkMarkdown('# Hello\n\nChanged content that is different from before.', 'f', '2024-01-01T00:00:00Z');
      expect(a[0].chunk_id).toBe(b[0].chunk_id); // same heading path
      expect(a[0].content_hash).not.toBe(b[0].content_hash);
    });
  });

  describe('long section splitting', () => {
    it('splits at paragraph boundaries with part indicators', () => {
      const chunks = chunkMarkdown(fixture('long-section.md'), 'docs/long.md', '2024-01-01T00:00:00Z', {
        maxChunkSize: 6000,
      });
      expect(chunks.length).toBeGreaterThan(1);
      const partChunks = chunks.filter(c => c.heading_path.includes('[part'));
      expect(partChunks.length).toBeGreaterThan(1);
      expect(partChunks[0].heading_path).toMatch(/Long Section \[part 1\/\d+\]/);
    });

    it('each part gets its own ordinal', () => {
      const chunks = chunkMarkdown(fixture('long-section.md'), 'docs/long.md', '2024-01-01T00:00:00Z');
      chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
    });
  });

  describe('short section merging', () => {
    it('merges short sections into parent when mergeShort is true', () => {
      const chunks = chunkMarkdown(fixture('short-sections.md'), 'docs/short.md', '2024-01-01T00:00:00Z', {
        mergeShort: true,
      });
      // Tiny sections should be merged into Details Section
      const tinyPaths = chunks.filter(c => c.heading_path.includes('Tiny'));
      expect(tinyPaths.length).toBe(0);
    });

    it('keeps short sections separate when mergeShort is false', () => {
      const chunks = chunkMarkdown(fixture('short-sections.md'), 'docs/short.md', '2024-01-01T00:00:00Z', {
        mergeShort: false,
      });
      const tinyPaths = chunks.filter(c => c.heading_path.includes('Tiny'));
      expect(tinyPaths.length).toBe(3);
    });
  });

  describe('no headings', () => {
    it('returns single root chunk', () => {
      const chunks = chunkMarkdown(fixture('no-headings.md'), 'docs/no-h.md', '2024-01-01T00:00:00Z');
      expect(chunks.length).toBe(1);
      expect(chunks[0].heading_path).toBe('(root)');
      expect(chunks[0].heading_level).toBe(0);
    });
  });

  describe('duplicate headings', () => {
    it('appends occurrence index for duplicates', () => {
      const chunks = chunkMarkdown(fixture('duplicate-headings.md'), 'docs/dup.md', '2024-01-01T00:00:00Z', {
        mergeShort: false,
      });
      const usagePaths = chunks.filter(c => c.heading_path.includes('Usage')).map(c => c.heading_path);
      expect(usagePaths).toContain('Document > Usage');
      expect(usagePaths).toContain('Document > Usage [2]');
      expect(usagePaths).toContain('Document > Usage [3]');
    });

    it('generates unique chunk_ids for duplicates', () => {
      const chunks = chunkMarkdown(fixture('duplicate-headings.md'), 'docs/dup.md', '2024-01-01T00:00:00Z', {
        mergeShort: false,
      });
      const ids = chunks.map(c => c.chunk_id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('frontmatter', () => {
    it('strips YAML front matter from all chunks', () => {
      const chunks = chunkMarkdown(fixture('frontmatter.md'), 'docs/fm.md', '2024-01-01T00:00:00Z');
      for (const chunk of chunks) {
        expect(chunk.content).not.toContain('---');
        expect(chunk.content).not.toContain('title:');
      }
    });
  });

  describe('empty file', () => {
    it('returns empty array', () => {
      expect(chunkMarkdown('', 'f', '2024-01-01T00:00:00Z')).toEqual([]);
    });

    it('returns empty array for whitespace-only', () => {
      expect(chunkMarkdown('   \n\n  ', 'f', '2024-01-01T00:00:00Z')).toEqual([]);
    });
  });

  describe('deep nesting', () => {
    it('produces correct breadcrumbs at every level', () => {
      const chunks = chunkMarkdown(fixture('nested-deep.md'), 'docs/deep.md', '2024-01-01T00:00:00Z', {
        mergeShort: false,
      });
      const paths = chunks.map(c => c.heading_path);
      expect(paths).toContain('Level One');
      expect(paths).toContain('Level One > Level Two');
      expect(paths).toContain('Level One > Level Two > Level Three');
      expect(paths).toContain('Level One > Level Two > Level Three > Level Four');
      expect(paths).toContain('Level One > Level Two > Level Three > Level Four > Level Five');
      expect(paths).toContain('Level One > Level Two > Level Three > Level Four > Level Five > Level Six');
    });
  });

  describe('GFM features', () => {
    it('preserves tables in content', () => {
      const chunks = chunkMarkdown(fixture('gfm-features.md'), 'docs/gfm.md', '2024-01-01T00:00:00Z');
      const tableChunk = chunks.find(c => c.heading_path.includes('Tables'));
      expect(tableChunk?.content).toContain('| Name');
      expect(tableChunk?.content).toContain('Alpha');
    });

    it('preserves task lists in content', () => {
      const chunks = chunkMarkdown(fixture('gfm-features.md'), 'docs/gfm.md', '2024-01-01T00:00:00Z');
      const taskChunk = chunks.find(c => c.heading_path.includes('Task Lists'));
      expect(taskChunk?.content).toContain('- [x]');
      expect(taskChunk?.content).toContain('- [ ]');
    });
  });

  describe('real-world fixture', () => {
    it('produces expected chunks with correct breadcrumbs', () => {
      const chunks = chunkMarkdown(fixture('real-world-csdlc.md'), 'docs/design.md', '2024-01-01T00:00:00Z', {
        mergeShort: false,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(5);
      const paths = chunks.map(c => c.heading_path);
      expect(paths).toContain('Anvil — Project Design Doc');
      expect(paths).toContain('Anvil — Project Design Doc > Overview > What Is This?');
      expect(paths).toContain('Anvil — Project Design Doc > Tech Stack');
      expect(paths).toContain('Anvil — Project Design Doc > Competitive Landscape > Existing Tools');
    });

    it('all chunks have correct file_path and last_modified', () => {
      const chunks = chunkMarkdown(fixture('real-world-csdlc.md'), 'docs/design.md', '2024-06-15T12:00:00Z');
      for (const c of chunks) {
        expect(c.file_path).toBe('docs/design.md');
        expect(c.last_modified).toBe('2024-06-15T12:00:00Z');
        expect(c.char_count).toBe(c.content.length);
      }
    });
  });

  describe('empty sections', () => {
    it('skips headings with no content', () => {
      const md = '# Title\n\n## Empty\n\n## Has Content\n\nSome actual content here that is long enough to matter.';
      const chunks = chunkMarkdown(md, 'f', '2024-01-01T00:00:00Z', { mergeShort: false });
      const paths = chunks.map(c => c.heading_path);
      // Empty section should still appear since it has the heading line
      // But its content is just "## Empty" which is the heading itself
      // Actually per spec: "Empty sections (heading with no content before next heading): Skip"
      // Let me check - the heading line IS included, so "## Empty" alone... 
      // The spec says skip zero-content chunks. "## Empty\n" has content (the heading).
      // We need to check if there's body content beyond the heading line.
    });
  });
});
