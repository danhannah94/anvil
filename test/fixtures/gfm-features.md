# GFM Features

This document tests GitHub Flavored Markdown features to ensure they are preserved in chunk content. It covers tables, task lists, and strikethrough formatting which are all part of the GFM specification.

## Tables

Here is a table that should be preserved exactly as written in the chunk content output:

| Name | Value | Description |
|------|-------|-------------|
| Alpha | 1 | First item in the table |
| Beta | 2 | Second item in the table |
| Gamma | 3 | Third item in the table |

The table above demonstrates that pipe-delimited table syntax is preserved.

## Task Lists

Here are some tasks to complete for the project roadmap and development plan:

- [x] Implement chunker
- [x] Write tests
- [ ] Add embeddings
- [ ] Build MCP server

These task lists use GFM checkbox syntax that should be preserved verbatim in the output.

## Strikethrough

This feature is ~~not important~~ very important for testing GFM support in the chunker implementation. The strikethrough syntax uses double tildes and should remain intact in the chunk content output.
