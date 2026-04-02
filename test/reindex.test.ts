import { describe, it, expect, afterEach } from "vitest";
import { createAnvil, type Anvil } from "../src/anvil.js";
import { mkdtempSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmpDocs(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anvil-reindex-"));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

describe("reindexFiles", () => {
  let anvil: Anvil | null = null;

  afterEach(async () => {
    if (anvil) {
      await anvil.close();
      anvil = null;
    }
  });

  it("reindexes only the specified file", async () => {
    const dir = makeTmpDocs({
      "a.md": "# Alpha\nAlpha content with enough text to be indexed as a meaningful chunk for testing.",
      "b.md": "# Beta\nBeta content with enough text to be indexed as a meaningful chunk for testing.",
    });
    anvil = await createAnvil({ docsPath: dir });

    // Full index first
    await anvil.index();

    // Now reindex only a.md
    const result = await anvil.reindexFiles(["a.md"]);
    expect(result.files_processed).toBe(1);
    expect(result.chunks_unchanged).toBeGreaterThan(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  }, 60000);

  it("removes chunks for a deleted file", async () => {
    const dir = makeTmpDocs({
      "keep.md": "# Keep\nKeep content with enough text to be indexed as a meaningful chunk for testing.",
      "delete-me.md": "# Delete Me\nThis file will be deleted after indexing to test removal of chunks from the index.",
    });
    anvil = await createAnvil({ docsPath: dir });

    // Full index first
    await anvil.index();

    // Delete the file from disk
    unlinkSync(join(dir, "delete-me.md"));

    // Reindex the deleted file — should remove its chunks
    const result = await anvil.reindexFiles(["delete-me.md"]);
    expect(result.files_processed).toBe(1);
    expect(result.chunks_deleted).toBeGreaterThan(0);
    expect(result.chunks_added).toBe(0);

    // Verify the file's chunks are gone
    const page = await anvil.getPage("delete-me.md");
    expect(page).toBeNull();
  }, 60000);

  it("returns zero stats for empty file list", async () => {
    const dir = makeTmpDocs({
      "a.md": "# Alpha\nAlpha content with enough text for meaningful indexing and testing purposes.",
    });
    anvil = await createAnvil({ docsPath: dir });

    const result = await anvil.reindexFiles([]);
    expect(result.files_processed).toBe(0);
    expect(result.chunks_added).toBe(0);
    expect(result.chunks_updated).toBe(0);
    expect(result.chunks_unchanged).toBe(0);
    expect(result.chunks_deleted).toBe(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  }, 60000);

  it("handles a file that was never indexed and does not exist on disk", async () => {
    const dir = makeTmpDocs({
      "a.md": "# Alpha\nAlpha content with enough text for meaningful indexing and testing purposes.",
    });
    anvil = await createAnvil({ docsPath: dir });

    // Reindex a file that never existed — should be a no-op
    const result = await anvil.reindexFiles(["nonexistent.md"]);
    expect(result.files_processed).toBe(1);
    expect(result.chunks_added).toBe(0);
    expect(result.chunks_deleted).toBe(0);
  }, 60000);

  it("reindexes a modified file", async () => {
    const dir = makeTmpDocs({
      "doc.md": "# Original\nOriginal content with enough text to be indexed as a meaningful chunk for testing.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();

    // Modify the file
    writeFileSync(
      join(dir, "doc.md"),
      "# Updated\nCompletely new content that should replace the original indexed content in the search index.",
    );

    const result = await anvil.reindexFiles(["doc.md"]);
    expect(result.files_processed).toBe(1);
    // Should have some updates or adds
    expect(result.chunks_added + result.chunks_updated).toBeGreaterThan(0);
  }, 60000);
});
