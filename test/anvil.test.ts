import { describe, it, expect, afterEach } from "vitest";
import { createAnvil, type Anvil } from "../src/anvil.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmpDocs(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anvil-lib-"));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

describe("createAnvil", () => {
  let anvil: Anvil | null = null;

  afterEach(async () => {
    if (anvil) {
      await anvil.close();
      anvil = null;
    }
  });

  it("returns an Anvil instance with valid docsPath", async () => {
    const dir = makeTmpDocs({ "hello.md": "# Hello\nWorld content here for testing purposes with enough text." });
    anvil = await createAnvil({ docsPath: dir });
    expect(anvil).toBeDefined();
    expect(anvil.search).toBeTypeOf("function");
    expect(anvil.getPage).toBeTypeOf("function");
    expect(anvil.getSection).toBeTypeOf("function");
    expect(anvil.listPages).toBeTypeOf("function");
    expect(anvil.getStatus).toBeTypeOf("function");
    expect(anvil.index).toBeTypeOf("function");
    expect(anvil.close).toBeTypeOf("function");
  }, 60000);

  it("throws with missing docsPath", async () => {
    await expect(
      createAnvil({ docsPath: "/nonexistent/path/that/does/not/exist" }),
    ).rejects.toThrow("docsPath does not exist");
  });

  it("throws with empty docsPath", async () => {
    await expect(createAnvil({ docsPath: "" })).rejects.toThrow(
      "docsPath is required",
    );
  });

  it("index() indexes markdown files and returns stats", async () => {
    const dir = makeTmpDocs({
      "a.md": "# Alpha\nAlpha content with enough text to be indexed as a meaningful chunk.",
      "b.md": "# Beta\nBeta content with enough text to be indexed as a meaningful chunk.",
      "sub/c.md": "# Charlie\nCharlie content with enough text for indexing purposes.",
    });
    anvil = await createAnvil({ docsPath: dir });
    const result = await anvil.index();
    expect(result.files_processed).toBe(3);
    expect(result.chunks_added).toBeGreaterThan(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  }, 60000);

  it("search() returns results after indexing", async () => {
    const dir = makeTmpDocs({
      "guide.md":
        "# User Guide\nThis guide explains how to use the application effectively for document retrieval and semantic search.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const results = await anvil.search("document retrieval");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].metadata.file_path).toBe("guide.md");
  }, 60000);

  it("getPage() returns page content", async () => {
    const dir = makeTmpDocs({
      "page.md":
        "# My Page\nPage content with enough text for testing the getPage functionality in detail.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const page = await anvil.getPage("page.md");
    expect(page).not.toBeNull();
    expect(page!.file_path).toBe("page.md");
    expect(page!.title).toBe("My Page");
    expect(page!.chunks.length).toBeGreaterThan(0);
  }, 60000);

  it("getPage() returns null for nonexistent page", async () => {
    const dir = makeTmpDocs({
      "page.md": "# Page\nContent here for testing with enough text.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const page = await anvil.getPage("nonexistent.md");
    expect(page).toBeNull();
  }, 60000);

  it("getSection() returns section content", async () => {
    const setupText = "Setup instructions that are detailed enough to exceed the minimum chunk size threshold used by the chunker module. ".repeat(3);
    const usageText = "Usage details explaining how to use all the features of this library in a real production environment. ".repeat(3);
    const dir = makeTmpDocs({
      "doc.md":
        `# Doc\nIntro paragraph with enough content to stand on its own as a meaningful chunk section.\n\n## Setup\n${setupText}\n\n## Usage\n${usageText}`,
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const section = await anvil.getSection("doc.md", "Doc > Setup");
    expect(section).not.toBeNull();
    expect(section!.content).toContain("Setup instructions");
    expect(section!.metadata.file_path).toBe("doc.md");
  }, 60000);

  it("getSection() returns null for nonexistent section", async () => {
    const dir = makeTmpDocs({
      "doc.md": "# Doc\nContent for testing the section functionality.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const section = await anvil.getSection("doc.md", "Doc > Nonexistent");
    expect(section).toBeNull();
  }, 60000);

  it("listPages() returns page list", async () => {
    const dir = makeTmpDocs({
      "a.md": "# Alpha\nAlpha content with enough text for meaningful indexing and testing.",
      "b.md": "# Beta\nBeta content with enough text for meaningful indexing and testing.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const result = await anvil.listPages();
    expect(result.total_pages).toBe(2);
    expect(result.pages.length).toBe(2);
    expect(result.pages.map((p) => p.file_path).sort()).toEqual([
      "a.md",
      "b.md",
    ]);
  }, 60000);

  it("listPages() filters by prefix", async () => {
    const dir = makeTmpDocs({
      "guide/a.md": "# Guide A\nContent for testing with enough text for the chunker.",
      "guide/b.md": "# Guide B\nContent for testing with enough text for the chunker.",
      "ref/c.md": "# Ref C\nContent for testing with enough text for the chunker.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const result = await anvil.listPages("guide/");
    expect(result.total_pages).toBe(2);
  }, 60000);

  it("getStatus() returns status object", async () => {
    const dir = makeTmpDocs({
      "page.md":
        "# Page\nContent for testing the status endpoint with enough text.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.index();
    const status = await anvil.getStatus();
    expect(status.total_pages).toBe(1);
    expect(status.total_chunks).toBeGreaterThan(0);
    expect(status.embedding.provider).toBe("local");
    expect(status.embedding.dimensions).toBe(384);
    expect(status.docs_path).toBe(dir);
    expect(status.db_path).toContain(".anvil");
  }, 60000);

  it("close() cleans up without error", async () => {
    const dir = makeTmpDocs({
      "page.md": "# Page\nContent for testing close with enough text here.",
    });
    anvil = await createAnvil({ docsPath: dir });
    await anvil.close();
    anvil = null; // Prevent double-close in afterEach
  }, 60000);
});
