import { describe, expect, it } from "vitest";

import { normalizeRelatedFileHint } from "../../src/lib/mesh-tools/related-file-hints";

describe("normalizeRelatedFileHint", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeRelatedFileHint("src\\api\\handler.ts")).toBe("src/api/handler.ts");
  });

  it("strips a leading ./ prefix", () => {
    expect(normalizeRelatedFileHint("./src/api/handler.ts")).toBe("src/api/handler.ts");
  });

  it("collapses repeated slashes", () => {
    expect(normalizeRelatedFileHint("src//api///handler.ts")).toBe("src/api/handler.ts");
  });

  it("strips trailing dots", () => {
    expect(normalizeRelatedFileHint("src/api/handler.ts...")).toBe("src/api/handler.ts");
  });

  it("still strips trailing slashes", () => {
    expect(normalizeRelatedFileHint("prompt-library///")).toBe("prompt-library");
  });

  it("preserves case because git path matching is case-sensitive", () => {
    expect(normalizeRelatedFileHint("./Src/API/Handler.ts")).toBe("Src/API/Handler.ts");
  });
});
