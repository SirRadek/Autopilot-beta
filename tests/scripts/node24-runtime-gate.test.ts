import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseNodeMajor, requireNode24 } from "../../scripts/lib/require-node24.mjs";

const root = process.cwd();

describe("Node 24 runtime gate", () => {
  it.each([
    ["24.18.0", 24],
    ["v24.0.0", 24],
    ["bad", null],
  ])("parses %s", (value, expected) => {
    expect(parseNodeMajor(value)).toBe(expected);
  });

  it("accepts Node 24", () => {
    expect(() =>
      requireNode24({ version: "24.18.0", execPath: "/trusted/node" }),
    ).not.toThrow();
  });

  it.each(["18.19.1", "25.0.0", "bad"])(
    "refuses %s before application work",
    (version) => {
      const writeError = vi.fn();

      expect(() =>
        requireNode24({ version, execPath: "/usr/bin/node", writeError }),
      ).toThrow(/node24_required/);
      expect(writeError).toHaveBeenCalledWith(
        expect.stringContaining(`actual=${version}`),
      );
    },
  );

  it("gates every persistent Git hook before npm or tsx", () => {
    for (const name of ["pre-commit", "pre-push", "commit-msg"]) {
      const text = readFileSync(join(root, "scripts/git-hooks", name), "utf8");
      expect(text.indexOf("require-node24.mjs"), name).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("require-node24.mjs"), name).toBeLessThan(
        text.search(/npm|tsx/),
      );
    }
  });

  it("gates hook installation before reading Git configuration", () => {
    const text = readFileSync(
      join(root, "scripts/git-hooks/install.mjs"),
      "utf8",
    );

    expect(text.indexOf("requireNode24()")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("requireNode24()")).toBeLessThan(
      text.indexOf('git(["rev-parse"'),
    );
  });
});
