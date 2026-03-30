import { AnvilDatabase } from './db.js';
import type { EmbeddingProvider } from './embedder.js';
import type { Chunk } from './types.js';
import { basename } from 'node:path';

export interface SearchResult {
  content: string;
  score: number;
  metadata: {
    file_path: string;
    heading_path: string;
    heading_level: number;
    last_modified: string;
    char_count: number;
  };
}

export interface PageResult {
  file_path: string;
  title: string;
  last_modified: string;
  total_chars: number;
  chunks: Array<{
    content: string;
    heading_path: string;
    heading_level: number;
    char_count: number;
    ordinal: number;
  }>;
}

export interface SectionResult {
  content: string;
  metadata: {
    file_path: string;
    heading_path: string;
    heading_level: number;
    last_modified: string;
    char_count: number;
  };
}

export interface PageSummary {
  file_path: string;
  title: string;
  headings: string[];
  chunk_count: number;
  total_chars: number;
  last_modified: string;
}

export class QueryEngine {
  constructor(
    private db: AnvilDatabase,
    private embedder: EmbeddingProvider
  ) {}

  async vectorSearch(query: string, topK: number = 5, fileFilter?: string): Promise<{ results: SearchResult[]; total_chunks: number; query_ms: number }> {
    const start = Date.now();
    const queryEmbedding = await this.embedder.embed(query);
    const embeddingBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

    // If filtering, fetch more to account for post-filter reduction
    const fetchLimit = fileFilter ? topK * 4 : topK;
    const rows = this.db.vectorSearch(embeddingBuffer, fetchLimit);

    let results: SearchResult[] = rows.map(row => ({
      content: row.content,
      score: 1 / (1 + row.distance),
      metadata: {
        file_path: row.file_path,
        heading_path: row.heading_path,
        heading_level: row.heading_level,
        last_modified: row.last_modified,
        char_count: row.char_count,
      },
    }));

    if (fileFilter) {
      results = results.filter(r => matchGlob(r.metadata.file_path, fileFilter));
    }

    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, topK);

    const totalChunks = this.db.getAllChunks().length;
    return { results, total_chunks: totalChunks, query_ms: Date.now() - start };
  }

  getPageChunks(filePath: string): PageResult | null {
    const chunks = this.db.getChunksByFile(filePath);
    if (chunks.length === 0) return null;

    const h1 = chunks.find(c => c.heading_level === 1);
    const title = h1 ? h1.heading_path : basename(filePath, '.md');
    const totalChars = chunks.reduce((sum, c) => sum + c.char_count, 0);
    const lastModified = chunks.reduce((max, c) => c.last_modified > max ? c.last_modified : max, chunks[0].last_modified);

    return {
      file_path: filePath,
      title,
      last_modified: lastModified,
      total_chars: totalChars,
      chunks: chunks.map(c => ({
        content: c.content,
        heading_path: c.heading_path,
        heading_level: c.heading_level,
        char_count: c.char_count,
        ordinal: c.ordinal,
      })),
    };
  }

  getSectionChunks(filePath: string, headingPath: string): SectionResult | null {
    // Try exact match first
    const exact = this.db.getChunkByHeading(filePath, headingPath);
    if (exact) {
      return {
        content: exact.content,
        metadata: {
          file_path: exact.file_path,
          heading_path: exact.heading_path,
          heading_level: exact.heading_level,
          last_modified: exact.last_modified,
          char_count: exact.char_count,
        },
      };
    }

    // Try multi-part chunks
    const parts = this.db.getChunksByHeadingPrefix(filePath, headingPath);
    if (parts.length === 0) return null;

    const combined = parts.map(p => p.content).join('\n\n');
    const totalChars = parts.reduce((sum, p) => sum + p.char_count, 0);
    const lastModified = parts.reduce((max, p) => p.last_modified > max ? p.last_modified : max, parts[0].last_modified);

    return {
      content: combined,
      metadata: {
        file_path: filePath,
        heading_path: headingPath,
        heading_level: parts[0].heading_level,
        last_modified: lastModified,
        char_count: totalChars,
      },
    };
  }

  listPages(prefix?: string): { pages: PageSummary[]; total_pages: number } {
    let files = this.db.getDistinctFiles();
    if (prefix) {
      files = files.filter(f => f.startsWith(prefix));
    }

    const pages: PageSummary[] = files.map(filePath => {
      const chunks = this.db.getChunksByFile(filePath);
      const h1 = chunks.find(c => c.heading_level === 1);
      const title = h1 ? h1.heading_path : basename(filePath, '.md');
      const headings = chunks
        .filter(c => c.heading_level <= 2)
        .map(c => c.heading_path)
        .filter((v, i, a) => a.indexOf(v) === i); // dedupe
      const totalChars = chunks.reduce((sum, c) => sum + c.char_count, 0);
      const lastModified = chunks.reduce((max, c) => c.last_modified > max ? c.last_modified : max, chunks[0].last_modified);

      return {
        file_path: filePath,
        title,
        headings,
        chunk_count: chunks.length,
        total_chars: totalChars,
        last_modified: lastModified,
      };
    });

    return { pages, total_pages: pages.length };
  }
}

/** Simple glob matching: supports * and ** patterns, or plain prefix match */
function matchGlob(filePath: string, pattern: string): boolean {
  // Simple cases
  if (pattern === '*' || pattern === '**') return true;
  if (!pattern.includes('*')) return filePath.startsWith(pattern);

  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}`).test(filePath);
}
