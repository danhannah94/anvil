# Changelog

## [0.1.0] - 2026-03-26

### Added

- **MCP server** with stdio transport — 5 tools: `search_docs`, `get_page`, `get_section`, `list_pages`, `get_status`
- **Markdown chunking** by heading structure with remark AST parsing
  - Frontmatter exclusion, duplicate heading disambiguation
  - Short-section merging into parent chunks
  - Long-section splitting at paragraph boundaries
- **Local embeddings** via `all-MiniLM-L6-v2` (384-dim, no API keys)
- **SQLite + sqlite-vss** for vector similarity search
- **Incremental indexing** — only re-embeds changed chunks
- **File watcher** with debounced re-indexing on add/change/delete
- **CLI commands**: `serve` (default), `index` (one-shot), `init` (config wizard)
- **Config system** — `anvil.config.json` with validation, CLI flag overrides, auto-discovery
- **Glob-based file filtering** in `search_docs`
- **Staleness checking** before every query
- **Git status** in `get_status` tool output
