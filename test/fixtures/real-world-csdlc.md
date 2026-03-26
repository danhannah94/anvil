# Anvil — Project Design Doc

## Overview

### What Is This?

Anvil is an open-source MCP server that makes any document collection queryable by AI agents. Point it at a directory of markdown files, and it automatically chunks your content by structure, generates embeddings, and stores them in a local vector database.

### Why This Exists

Written content has always served one audience: humans. But now there's a second audience: AI agents. Their needs are fundamentally different. Humans skim, scan, and use visual hierarchy. Agents need semantic boundaries, consistent chunk sizes, and metadata that describes the content's place in the larger whole. Anvil bridges this gap by transforming human-authored documents into agent-queryable knowledge bases without requiring any changes to how you write.

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js (TypeScript) | Single language for the entire product |
| Markdown Parsing | unified / remark | Mature markdown AST parser |
| Vector DB | sqlite-vss via better-sqlite3 | Zero infrastructure |
| Embeddings | @huggingface/transformers | Local inference, no API keys |

### Architecture Decision: All TypeScript

The entire product runs in a single Node.js process. No Python dependency, no multi-process coordination. This keeps the supply chain narrow and the developer experience simple. Install one package, run one command, get a working knowledge base. The tradeoff is that some ML operations (like embedding generation) may be slower than native Python equivalents, but for document collections under 10,000 files the performance is more than adequate.

## Competitive Landscape

### Existing Tools

Several tools exist in this space. All are Python-based. LangChain, LlamaIndex, and Haystack each provide document chunking and retrieval, but they come with heavy dependency trees and require Python runtime configuration. For TypeScript developers building MCP servers, this means maintaining two language runtimes.

### Why We're Still Building This

Supply chain ownership, TypeScript ecosystem, heading-based chunking quality. We believe that structure-aware chunking (splitting at heading boundaries rather than arbitrary token counts) produces higher-quality retrieval results. Combined with a zero-config local setup, Anvil fills a gap that existing tools leave open.
