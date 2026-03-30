import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Anvil } from '../anvil.js';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';

export interface ServerContext {
  anvil: Anvil;
  startTime: number;
  version: string;
}

const toolDefinitions = [
  {
    name: 'search_docs',
    description: 'Semantic search across all indexed documentation. Returns relevant chunks ranked by similarity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        top_k: { type: 'number', description: 'Number of results (1-20, default 5)' },
        file_filter: { type: 'string', description: 'Glob pattern to scope search' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page',
    description: 'Retrieve full page content by file path. Returns all chunks in document order.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Relative path within docs/ (e.g., "architecture.md")' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_section',
    description: 'Retrieve a specific section by heading path. Use get_page to discover available heading paths.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Relative path within docs/' },
        heading_path: { type: 'string', description: 'Heading breadcrumb (e.g., "Architecture > Data Flow")' },
      },
      required: ['file_path', 'heading_path'],
    },
  },
  {
    name: 'list_pages',
    description: 'List all indexed pages with metadata. Use to discover what documentation is available.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prefix: { type: 'string', description: 'Filter by path prefix (e.g., "epics/")' },
      },
    },
  },
  {
    name: 'get_status',
    description: 'Server health, index state, and version info.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

function jsonResponse(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : {}),
  };
}

function matchGlob(filePath: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '**') return true;
  if (!pattern.includes('*')) return filePath.startsWith(pattern);
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}`).test(filePath);
}

async function handleSearchDocs(
  anvil: Anvil,
  checkStaleness: () => Promise<void>,
  params: Record<string, unknown>,
) {
  const query = params.query;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return jsonResponse({ error: 'query parameter is required' }, true);
  }
  let topK = typeof params.top_k === 'number' ? params.top_k : 5;
  topK = Math.max(1, Math.min(20, topK));
  const fileFilter = typeof params.file_filter === 'string' ? params.file_filter : undefined;
  await checkStaleness();
  let results = await anvil.search(query, fileFilter ? topK * 4 : topK);
  if (fileFilter) {
    results = results.filter(r => matchGlob(r.metadata.file_path, fileFilter));
    results = results.slice(0, topK);
  }
  return jsonResponse({ results });
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\//, '');
}

async function handleGetPage(
  anvil: Anvil,
  checkStaleness: () => Promise<void>,
  params: Record<string, unknown>,
) {
  const filePath = params.file_path;
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return jsonResponse({ error: 'file_path parameter is required' }, true);
  }
  const normalized = normalizePath(filePath);
  await checkStaleness();
  const result = await anvil.getPage(normalized);
  if (!result) {
    return jsonResponse({ error: `No page found at path: ${normalized}. Use list_pages to discover available pages.` }, true);
  }
  return jsonResponse(result);
}

async function handleGetSection(
  anvil: Anvil,
  checkStaleness: () => Promise<void>,
  params: Record<string, unknown>,
) {
  const filePath = params.file_path;
  const headingPath = params.heading_path;
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return jsonResponse({ error: 'file_path parameter is required' }, true);
  }
  if (!headingPath || typeof headingPath !== 'string' || headingPath.trim() === '') {
    return jsonResponse({ error: 'heading_path parameter is required' }, true);
  }
  const normalized = normalizePath(filePath);
  await checkStaleness();
  const result = await anvil.getSection(normalized, headingPath);
  if (!result) {
    return jsonResponse({ error: `No section found at heading: ${headingPath} in ${normalized}. Use get_page to see available sections.` }, true);
  }
  return jsonResponse(result);
}

async function handleListPages(
  anvil: Anvil,
  checkStaleness: () => Promise<void>,
  params: Record<string, unknown>,
) {
  let prefix = typeof params.prefix === 'string' ? params.prefix : undefined;
  if (prefix) {
    // Normalize: strip trailing slash for consistency
    prefix = prefix.replace(/\/+$/, '');
    if (prefix) prefix = prefix + '/';
  }
  await checkStaleness();
  const result = await anvil.listPages(prefix);
  return jsonResponse(result);
}

async function handleGetStatus(
  anvil: Anvil,
  ctx: ServerContext,
) {
  const status = await anvil.getStatus();

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(status.db_path).size;
  } catch { /* ignore */ }

  let git: { head_commit: string; origin_main: string | null; dirty: boolean } | null = null;
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: status.docs_path, encoding: 'utf-8' }).trim();
    let originMain: string | null = null;
    try {
      originMain = execSync('git rev-parse --short origin/main', { cwd: status.docs_path, encoding: 'utf-8' }).trim();
    } catch { /* no remote */ }
    const porcelain = execSync('git status --porcelain -- .', { cwd: status.docs_path, encoding: 'utf-8' }).trim();
    git = { head_commit: head, origin_main: originMain, dirty: porcelain.length > 0 };
  } catch { /* not a git repo */ }

  return jsonResponse({
    server: {
      version: ctx.version,
      uptime_seconds: Math.floor((Date.now() - ctx.startTime) / 1000),
      docs_root: status.docs_path,
    },
    index: {
      total_pages: status.total_pages,
      total_chunks: status.total_chunks,
      last_indexed: status.last_indexed,
      db_path: status.db_path,
      db_size_bytes: dbSizeBytes,
    },
    embedding: {
      model: status.embedding.model,
      dimensions: status.embedding.dimensions,
      provider: status.embedding.provider,
    },
    git,
  });
}

export function registerAllTools(
  server: Server,
  checkStaleness: () => Promise<void>,
  ctx: ServerContext,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'search_docs':
          return await handleSearchDocs(ctx.anvil, checkStaleness, params);
        case 'get_page':
          return await handleGetPage(ctx.anvil, checkStaleness, params);
        case 'get_section':
          return await handleGetSection(ctx.anvil, checkStaleness, params);
        case 'list_pages':
          return await handleListPages(ctx.anvil, checkStaleness, params);
        case 'get_status':
          return await handleGetStatus(ctx.anvil, ctx);
        default:
          return jsonResponse({ error: `Unknown tool: ${name}` }, true);
      }
    } catch (err) {
      return jsonResponse({ error: String(err) }, true);
    }
  });
}
