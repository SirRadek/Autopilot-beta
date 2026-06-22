import { describe, expect, it } from "vitest";

import { validateProductDesignOs } from "../../product-design-os/scripts/validate-product-design-os";

describe("validateProductDesignOs", () => {
  it("reports the F0 integrity inventory as warnings only", () => {
    const report = validateProductDesignOs();
    const countsByCode = new Map<string, number>();

    for (const warning of report.warnings) {
      const code = warning.code;
      expect(code).toBeDefined();
      if (code === undefined) {
        throw new Error(`Warning is missing code: ${warning.file}`);
      }
      countsByCode.set(code, (countsByCode.get(code) ?? 0) + 1);
    }

    expect(Object.fromEntries([...countsByCode.entries()].sort())).toEqual({
      PDOS_ASSET_REF_TAG_MIX: 3,
      PDOS_EMPTY_TOKENS: 6,
      PDOS_GHOST_PATTERN: 13
    });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });
});
