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

    expect(Object.fromEntries([...countsByCode.entries()].sort())).toEqual({});
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });
});
