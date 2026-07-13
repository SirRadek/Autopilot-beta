import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkDocumentationLinks } from "../../scripts/check-documentation-links";

const CANONICAL_DOCUMENTS = [
  "README.md",
  "docs/README.md",
  "docs/status/current-status.md"
] as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("documentation link checker", () => {
  it("accepts canonical indexes, local anchors, external links, and fenced examples", () => {
    const root = fixture({
      "README.md": [
        "# Project",
        "",
        "[Documentation](docs/README.md)",
        "[Status](docs/status/current-status.md#current-status)",
        "[Project section](#project)",
        "[Reference details](docs/reference.md#details)",
        "[Website](https://example.com)",
        "[Email](mailto:owner@example.com)",
        "",
        "```md",
        "[Planned example](docs/not-created.md)",
        "```"
      ].join("\n"),
      "docs/README.md": [
        "# Documentation",
        "",
        "[Project](../README.md#project)",
        "[Status](status/current-status.md)"
      ].join("\n"),
      "docs/reference.md": "# Reference\n\n## Details\n",
      "docs/status/current-status.md": "# Current status\n"
    });

    expect(checkDocumentationLinks(root, CANONICAL_DOCUMENTS)).toEqual({
      checked_files: [...CANONICAL_DOCUMENTS],
      errors: []
    });
  });

  it("reports broken local targets deterministically", () => {
    const root = fixture({
      "README.md": "# Project\n\n[Documentation](docs/README.md)\n[Missing](docs/missing.md)\n[Status](docs/status/current-status.md)\n",
      "docs/README.md": "# Documentation\n\n[Project](../README.md)\n[Status](status/current-status.md)\n",
      "docs/status/current-status.md": "# Current status\n"
    });

    expect(checkDocumentationLinks(root, CANONICAL_DOCUMENTS).errors).toContain(
      "broken_local_link:README.md:docs/missing.md"
    );
  });

  it("requires every canonical document to be linked from both indexes", () => {
    const root = fixture({
      "README.md": "# Project\n\n[Documentation](docs/README.md)\n",
      "docs/README.md": "# Documentation\n\n[Project](../README.md)\n",
      "docs/status/current-status.md": "# Current status\n"
    });

    expect(checkDocumentationLinks(root, CANONICAL_DOCUMENTS).errors).toContain(
      "canonical_document_not_linked:docs/status/current-status.md"
    );
  });

  it("reports missing local anchors in the source or target document", () => {
    const root = fixture({
      "README.md": "# Project\n\n[Documentation](docs/README.md)\n[Status](docs/status/current-status.md#missing)\n[Missing section](#absent)\n",
      "docs/README.md": "# Documentation\n\n[Project](../README.md)\n[Status](status/current-status.md)\n",
      "docs/status/current-status.md": "# Current status\n"
    });

    expect(checkDocumentationLinks(root, CANONICAL_DOCUMENTS).errors).toEqual(expect.arrayContaining([
      "broken_local_anchor:README.md:README.md#absent",
      "broken_local_anchor:README.md:docs/status/current-status.md#missing"
    ]));
  });

  it("refuses to scan a canonical Markdown file larger than one MiB", () => {
    const root = fixture({
      "README.md": `# Project\n\n${"x".repeat(1_048_576)}`,
      "docs/README.md": "# Documentation\n",
      "docs/status/current-status.md": "# Current status\n"
    });

    expect(checkDocumentationLinks(root, CANONICAL_DOCUMENTS).errors).toContain(
      "documentation_file_too_large:README.md"
    );
  });
});

function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "documentation-links-"));
  temporaryDirectories.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  return root;
}
