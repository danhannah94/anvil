import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { QueryEngine } from '../query.js';

export function registerSearchDocs(
  server: Server,
  queryEngine: QueryEngine,
  checkStaleness: () => Promise<void>
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'search_docs',
      description: 'Semantic search across all indexed documentation. Returns relevant chunks ranked by similarity.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          top_k: { type: 'number', description: 'Number of results (1-20, default 5)' },
          file_filter: { type: 'string', description: 'Glob pattern to scope search (e.g., "epics/*")' },
        },
        required: ['query'],
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'search_docs') {
      const args = request.params.arguments as Record<string, unknown> | undefined;
      const query = args?.query;

      if (!query || typeof query !== 'string' || query.trim() === '') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'query parameter is required' }) }],
          isError: true,
        };
      }

      let topK = typeof args?.top_k === 'number' ? args.top_k : 5;
      topK = Math.max(1, Math.min(20, topK));

      const fileFilter = typeof args?.file_filter === 'string' ? args.file_filter : undefined;

      await checkStaleness();
      const result = await queryEngine.vectorSearch(query, topK, fileFilter);

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${request.params.name}` }) }],
      isError: true,
    };
  });
}
