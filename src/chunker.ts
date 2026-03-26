import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { createHash } from 'node:crypto';
import type { Chunk } from './types.js';

export interface ChunkerOptions {
  maxChunkSize?: number;
  minChunkSize?: number;
  mergeShort?: boolean;
}

interface RawSection {
  headingText: string;
  headingLevel: number;
  headingPath: string;
  content: string;
  parentIndex: number | null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function chunkMarkdown(
  content: string,
  filePath: string,
  lastModified: string,
  options?: ChunkerOptions
): Chunk[] {
  const maxChunkSize = options?.maxChunkSize ?? 6000;
  const minChunkSize = options?.minChunkSize ?? 200;
  const mergeShort = options?.mergeShort ?? true;

  // Empty / whitespace-only
  if (!content.trim()) return [];

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .parse(content);

  // Collect heading positions from AST
  interface HeadingInfo {
    depth: number;
    text: string;
    startLine: number; // 1-indexed from AST position
  }

  const headings: HeadingInfo[] = [];
  for (const node of tree.children) {
    if (node.type === 'heading' && node.position) {
      // Extract text from heading children
      let text = '';
      for (const child of (node as any).children ?? []) {
        if (child.type === 'text') text += child.value;
        else if (child.type === 'inlineCode') text += child.value;
      }
      headings.push({
        depth: (node as any).depth,
        text: text.trim(),
        startLine: node.position.start.line,
      });
    }
  }

  const lines = content.split('\n');

  // Find frontmatter end line to exclude it
  let contentStartLine = 1; // 1-indexed
  for (const node of tree.children) {
    if (node.type === 'yaml' || (node as any).type === 'toml') {
      if (node.position) {
        contentStartLine = node.position.end.line + 1;
      }
    }
  }

  // If no headings, return single root chunk (excluding frontmatter)
  if (headings.length === 0) {
    const rawContent = lines.slice(contentStartLine - 1).join('\n').trim();
    if (!rawContent) return [];
    return [{
      chunk_id: sha256(filePath + ':(root)'),
      file_path: filePath,
      heading_path: '(root)',
      heading_level: 0,
      content: rawContent,
      content_hash: sha256(rawContent),
      last_modified: lastModified,
      char_count: rawContent.length,
      ordinal: 0,
    }];
  }

  // Build sections from headings
  // Track heading stack for breadcrumbs and duplicate counting
  const headingCounts = new Map<string, number>();
  const sections: RawSection[] = [];

  // Content before first heading (excluding frontmatter)
  const preHeadingContent = lines.slice(contentStartLine - 1, headings[0].startLine - 1).join('\n').trim();
  if (preHeadingContent) {
    sections.push({
      headingText: '(root)',
      headingLevel: 0,
      headingPath: '(root)',
      content: preHeadingContent,
      parentIndex: null,
    });
  }

  // Heading stack: array of { text, level, displayText }
  const stack: { text: string; level: number; displayText: string }[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const startLine = h.startLine;
    const endLine = i + 1 < headings.length ? headings[i + 1].startLine - 1 : lines.length;

    const sectionContent = lines.slice(startLine - 1, endLine).join('\n').trimEnd();

    // Handle duplicate heading text
    const countKey = h.text;
    const count = (headingCounts.get(countKey) ?? 0) + 1;
    headingCounts.set(countKey, count);
    const displayText = count > 1 ? `${h.text} [${count}]` : h.text;

    // Update stack: pop to appropriate level
    while (stack.length > 0 && stack[stack.length - 1].level >= h.depth) {
      stack.pop();
    }
    stack.push({ text: h.text, level: h.depth, displayText });

    const headingPath = stack.map(s => s.displayText).join(' > ');

    // Find parent index (closest section with lower heading level)
    let parentIndex: number | null = null;
    if (stack.length > 1) {
      const parentPath = stack.slice(0, -1).map(s => s.displayText).join(' > ');
      for (let j = sections.length - 1; j >= 0; j--) {
        if (sections[j].headingPath === parentPath) {
          parentIndex = j;
          break;
        }
      }
    }

    // Check if section has content beyond the heading line itself
    const headingLineEnd = startLine; // heading is one line
    const bodyContent = lines.slice(headingLineEnd, endLine).join('\n').trim();
    if (!bodyContent && !sectionContent.trim()) continue; // skip empty

    sections.push({
      headingText: displayText,
      headingLevel: h.depth,
      headingPath,
      content: sectionContent,
      parentIndex,
    });
  }

  // Merge short sections if enabled
  if (mergeShort) {
    const removed = new Set<number>();
    // Process in reverse so merging doesn't shift indices
    for (let i = sections.length - 1; i >= 0; i--) {
      if (removed.has(i)) continue;
      const sec = sections[i];
      if (sec.content.length < minChunkSize && sec.parentIndex !== null && !removed.has(sec.parentIndex)) {
        const parent = sections[sec.parentIndex];
        parent.content += '\n\n' + sec.content;
        removed.add(i);
      }
    }

    // Build final sections list
    const filtered: RawSection[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (!removed.has(i)) filtered.push(sections[i]);
    }
    sections.length = 0;
    sections.push(...filtered);
  }

  // Split long sections and build final chunks
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const sec of sections) {
    if (sec.content.length <= maxChunkSize) {
      chunks.push({
        chunk_id: sha256(filePath + ':' + sec.headingPath),
        file_path: filePath,
        heading_path: sec.headingPath,
        heading_level: sec.headingLevel,
        content: sec.content,
        content_hash: sha256(sec.content),
        last_modified: lastModified,
        char_count: sec.content.length,
        ordinal: ordinal++,
      });
    } else {
      // Split at paragraph boundaries (blank lines)
      const paragraphs = sec.content.split(/\n\n+/);
      const parts: string[] = [];
      let current = '';
      for (const para of paragraphs) {
        if (current && (current + '\n\n' + para).length > maxChunkSize) {
          parts.push(current);
          current = para;
        } else {
          current = current ? current + '\n\n' + para : para;
        }
      }
      if (current) parts.push(current);

      const totalParts = parts.length;
      for (let p = 0; p < totalParts; p++) {
        const partPath = `${sec.headingPath} [part ${p + 1}/${totalParts}]`;
        const partContent = parts[p];
        chunks.push({
          chunk_id: sha256(filePath + ':' + partPath),
          file_path: filePath,
          heading_path: partPath,
          heading_level: sec.headingLevel,
          content: partContent,
          content_hash: sha256(partContent),
          last_modified: lastModified,
          char_count: partContent.length,
          ordinal: ordinal++,
        });
      }
    }
  }

  return chunks;
}
