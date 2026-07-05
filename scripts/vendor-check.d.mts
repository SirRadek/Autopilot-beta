// Types for the vendor-check gate so its unit tests can drive verify()/generate() against a
// temp fixture tree. The script itself lives outside tsconfig `include` (scripts/ is not vendored
// or typechecked); this declaration only shapes the importable surface.

export declare const CANONICAL_SHA: string;
export declare const VENDOR_ROOTS: readonly string[];

export interface VendorCheckOptions {
  readonly root?: string;
  readonly manifestPath?: string;
  readonly vendorRoots?: readonly string[];
}

export declare function collectVendoredFiles(root?: string, vendorRoots?: readonly string[]): string[];
export declare function generate(options?: VendorCheckOptions): void;
/** Throws on any provenance problem (missing manifest, drift, missing, untracked); returns on clean. */
export declare function verify(options?: VendorCheckOptions): void;
