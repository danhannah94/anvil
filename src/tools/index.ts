import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { QueryEngine } from '../query.js';
import { AnvilDatabase } from '../db.js';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';

export interface ServerContext {
  docsRoot: string;
  dbPath: string;
  db: AnvilDatabase;
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

async function handleSearchDocs(
  queryEngine: QueryEngine,
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
  const result = await queryEngine.vectorSearch(query, topK, fileFilter);
  return jsonResponse(result);
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\//, '');
}

async function handleGetPage(
  queryEngine: QueryEngine,
  checkStaleness: () => Promise<void>,
  params: Record<string, unknown>,
) {
  const filePath = params.file_path;
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return jsonResponse({ error: 'file_path parameter is required' }, true);
  }
  const normalized = normalizePath(filePath);
  await checkStaleness();
  const result = queryEngine.getPageChunks(normalized);
  if (!result) {
    return jsonResponse({ error: `No page found at path: ${normalized}. Use list_pages to discover available pages.` }, true);
  }
  return jsonResponse(result);
}

async function handleGetSection(
  queryEngine: QueryEngine,
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
  const result = queryEngine.getSectionChunks(normalized, headingPath);
  if (!result) {
    return jsonResponse({ error: `No section found at heading: ${headingPath} in ${normalized}. Use get_page to see available sections.` }, true);
  }
  return jsonResponse(result);
}

async function handleListPages(
  queryEngine: QueryEngine,
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
  const result = queryEngine.listPages(prefix);
  return jsonResponse(result);
}

function handleGetStatus(
  queryEngine: QueryEngine,
  ctx: ServerContext,
) {
  const pagesResult = queryEngine.listPages();
  const totalChunks = ctx.db.getAllChunks().length;
  const lastIndexed = ctx.db.getMeta('last_index_timestamp') ?? null;
  const embeddingModel = ctx.db.getMeta('embedding_model') ?? null;
  const embeddingDimensions = ctx.db.getMeta('embedding_dimensions') ?? null;

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(ctx.dbPath).size;
  } catch { /* ignore */ }

  let git: { head_commit: string; origin_main: string | null; dirty: boolean } | null = null;
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: ctx.docsRoot, encoding: 'utf-8' }).trim();
    let originMain: string | null = null;
    try {
      originMain = execSync('git rev-parse --short origin/main', { cwd: ctx.docsRoot, encoding: 'utf-8' }).trim();
    } catch { /* no remote */ }
    const porcelain = execSync('git status --porcelain -- .', { cwd: ctx.docsRoot, encoding: 'utf-8' }).trim();
    git = { head_commit: head, origin_main: originMain, dirty: porcelain.length > 0 };
  } catch { /* not a git repo */ }

  return jsonResponse({
    server: {
      version: ctx.version,
      uptime_seconds: Math.floor((Date.now() - ctx.startTime) / 1000),
      docs_root: ctx.docsRoot,
    },
    index: {
      total_pages: pagesResult.total_pages,
      total_chunks: totalChunks,
      last_indexed: lastIndexed,
      db_path: ctx.dbPath,
      db_size_bytes: dbSizeBytes,
    },
    embedding: {
      model: embeddingModel,
      dimensions: embeddingDimensions ? Number(embeddingDimensions) : null,
      provider: 'local',
    },
    git,
  });
}

export function registerAllTools(
  server: Server,
  queryEngine: QueryEngine,
  checkStaleness: () => Promise<void>,
  serverContext: ServerContext,
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
          return await handleSearchDocs(queryEngine, checkStaleness, params);
        case 'get_page':
          return await handleGetPage(queryEngine, checkStaleness, params);
        case 'get_section':
          return await handleGetSection(queryEngine, checkStaleness, params);
        case 'list_pages':
          return await handleListPages(queryEngine, checkStaleness, params);
        case 'get_status':
          return handleGetStatus(queryEngine, serverContext);
        default:
          return jsonResponse({ error: `Unknown tool: ${name}` }, true);
      }
    } catch (err) {
      return jsonResponse({ error: String(err) }, true);
    }
  });
}
