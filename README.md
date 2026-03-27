# @claymore-dev/anvil

**MCP server that makes your project docs searchable by AI.** Point it at a folder of markdown files, and it chunks, embeds, and serves them over the [Model Context Protocol](https://modelcontextprotocol.io/) — so your AI assistant can actually find relevant documentation.

## Quickstart

```bash
npm install -g @claymore-dev/anvil
cd your-project
anvil serve --docs ./docs
```

That's it. Anvil indexes your markdown, starts an MCP server on stdio, and exposes 5 tools your AI can call.

## What It Does

1. **Scans** a directory for `.md` files
2. **Chunks** them by heading structure (not fixed-size blocks)
3. **Embeds** each chunk using a local transformer model (no API keys needed)
4. **Stores** chunks + vectors in a local SQLite database with [sqlite-vss](https://github.com/asg017/sqlite-vss)
5. **Watches** for file changes and re-indexes automatically
6. **Serves** semantic search + page/section retrieval over MCP (stdio transport)

## Installation

```bash
npm install -g @claymore-dev/anvil
```

Requires Node.js 18+. The embedding model (~80 MB) downloads automatically on first run.

## Configuration

Create `anvil.config.json` in your project root (or run `anvil init`):

```json
{
  "docs": "./docs",
  "db": "./.anvil/index.db",
  "embedding": {
    "provider": "local",
    "model": "all-MiniLM-L6-v2"
  },
  "chunking": {
    "maxChunkSize": 6000,
    "minChunkSize": 200,
    "mergeShort": true
  },
  "watch": true,
  "logLevel": "info"
}
```

All fields are optional — defaults are shown above.

| Field | Description |
|---|---|
| `docs` | Path to markdown directory (default: `./`) |
| `db` | SQLite database path (default: `./.anvil/index.db`) |
| `embedding.provider` | `"local"` (default) or `"openai"` |
| `embedding.model` | HuggingFace model name (default: `all-MiniLM-L6-v2`) |
| `chunking.maxChunkSize` | Max characters per chunk before splitting (default: 6000) |
| `chunking.minChunkSize` | Short chunks below this merge into parent (default: 200) |
| `chunking.mergeShort` | Enable short-chunk merging (default: true) |
| `watch` | Watch for file changes (default: true) |
| `logLevel` | `silent`, `error`, `warn`, `info`, or `debug` |

CLI flags override config file values. Config file overrides defaults.

## MCP Client Setup

### Cursor

In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "anvil": {
      "command": "anvil",
      "args": ["serve", "--docs", "./docs"]
    }
  }
}
```

### Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "anvil": {
      "command": "anvil",
      "args": ["serve", "--docs", "/absolute/path/to/your/docs"]
    }
  }
}
```

### OpenClaw / mcporter

```json
{
  "mcpServers": {
    "anvil": {
      "command": "anvil",
      "args": ["serve", "--docs", "/absolute/path/to/your/docs"]
    }
  }
}
```

## CLI Reference

### `anvil serve` (default)

Start the MCP server over stdio.

```
anvil serve [options]
```

| Flag | Description |
|---|---|
| `-d, --docs <path>` | Docs directory (default: `./`) |
| `--db <path>` | Database path |
| `-c, --config <path>` | Config file path (default: `./anvil.config.json`) |
| `--no-config` | Ignore config file |
| `--no-watch` | Disable file watcher |
| `--max-chunk-size <n>` | Max chunk size in characters |
| `--min-chunk-size <n>` | Min chunk size before merge |
| `--embedding-provider <p>` | `local` or `openai` |
| `--log-level <level>` | `silent`, `error`, `warn`, `info`, `debug` |
| `-v, --version` | Print version |

### `anvil index`

One-shot indexing without starting the MCP server.

```
anvil index [options]
```

Same flags as `serve`, plus:

| Flag | Description |
|---|---|
| `--force` | Clear index and re-embed everything |

### `anvil init`

Create `anvil.config.json` interactively.

```
anvil init [--yes]
```

| Flag | Description |
|---|---|
| `--yes` | Skip prompts, use all defaults |

## MCP Tools

Anvil exposes 5 tools to connected MCP clients:

| Tool | Description |
|---|---|
| `search_docs` | Semantic search across all indexed docs |
| `get_page` | Retrieve full page content by file path |
| `get_section` | Retrieve a specific section by heading path |
| `list_pages` | List all indexed pages with metadata |
| `get_status` | Server health, index state, and version info |

## Architecture Overview

```
┌─────────────┐     ┌──────────┐     ┌──────────┐
│  .md files  │────▶│ Chunker  │────▶│ Embedder │
└─────────────┘     └──────────┘     └──────────┘
                         │                 │
                         ▼                 ▼
                    ┌─────────────────────────┐
                    │   SQLite + sqlite-vss   │
                    └─────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  MCP Server (stdio) │
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │  AI Client (Cursor, │
                    │  Claude Desktop...) │
                    └─────────────────────┘
```

- **Chunker** (`src/chunker.ts`) — Splits markdown by heading structure using remark AST. Handles frontmatter, duplicate headings, short-section merging, and long-section splitting.
- **Embedder** (`src/embedder.ts`) — Generates 384-dim vectors using `all-MiniLM-L6-v2` via `@huggingface/transformers`. Runs entirely local, no API keys.
- **Database** (`src/db.ts`) — SQLite with sqlite-vss for vector similarity search. WAL mode for concurrent reads.
- **Indexer** (`src/indexer.ts`) — Diffing engine that only re-embeds changed chunks. Detects model changes and triggers full re-embed.
- **Watcher** (`src/watcher.ts`) — Chokidar-based file watcher with debouncing. Re-indexes on add/change/delete.
- **Query Engine** (`src/query.ts`) — Vector search, page retrieval, section retrieval, and page listing.
- **Server** (`src/server.ts`) — Orchestrates startup: scan → index → watch → MCP.
- **Tools** (`src/tools/index.ts`) — MCP tool definitions and handlers.

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b my-feature`
3. Run tests: `npm test`
4. Submit a PR

## License

[MIT](LICENSE) © Dan Hannah
