// Thin, free-tier Figma reader for the design->AI loop.
//
// Reads ONE frame's structure from the Figma REST API (works on a free account
// with a Personal Access Token — no Dev Mode / paid seat) and cleans it into the
// Design Brief `nodes` subset: layout, text and role only — no absolute
// positions, GUIDs or render blobs. Token values are NOT read from Figma (the
// code is the source of truth); the brief author references token names.
//
// Usage (live fetch — provide your own read-only token, never commit it):
//   FIGMA_TOKEN=<pat> tsx scripts/figma-fetch.ts "<figma-frame-url>"
//   FIGMA_TOKEN=<pat> tsx scripts/figma-fetch.ts <fileKey> <nodeId>
// Output: a partial Design Brief (source + nodes) on stdout, ready to merge with
// intent / tokensRef / components by hand.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheDir = join(repoRoot, ".cache", "figma");
const MAX_NODES = 200;

export interface FigmaRef {
  readonly fileKey: string;
  readonly nodeId: string;
}

export interface BriefNode {
  readonly id: string;
  readonly role?: string;
  readonly layout?: { direction: "row" | "column" | "none"; gap?: string; padding?: string; align?: string; justify?: string };
  readonly text?: string;
}

/** Parse a Figma design/file URL (or a raw fileKey + nodeId pair) into a ref. */
export function parseFigmaRef(a: string, b?: string): FigmaRef {
  if (b !== undefined && !a.includes("/")) return { fileKey: a, nodeId: normalizeNodeId(b) };
  const url = new URL(a);
  const parts = url.pathname.split("/").filter(Boolean); // ["design","<key>","<name>"] or ["file","<key>",...]
  const keyIndex = parts.findIndex((part) => part === "design" || part === "file");
  const fileKey = keyIndex >= 0 ? parts[keyIndex + 1] : undefined;
  const nodeParam = url.searchParams.get("node-id");
  if (!fileKey || !nodeParam) throw new Error("could not parse fileKey / node-id from Figma URL");
  return { fileKey, nodeId: normalizeNodeId(nodeParam) };
}

/** Figma URLs use `42-7`; the REST API expects `42:7`. */
export function normalizeNodeId(value: string): string {
  return value.includes(":") ? value : value.replace("-", ":");
}

function layoutOf(node: Record<string, unknown>): BriefNode["layout"] | undefined {
  const mode = node.layoutMode;
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL") return undefined;
  const px = (v: unknown): string | undefined => (typeof v === "number" ? `${v}px` : undefined);
  const pads = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map(px);
  const layout: NonNullable<BriefNode["layout"]> = {
    direction: mode === "HORIZONTAL" ? "row" : "column",
    ...(typeof node.itemSpacing === "number" ? { gap: `${node.itemSpacing}px` } : {}),
    ...(pads.some((p) => p !== undefined) ? { padding: pads.map((p) => p ?? "0px").join(" ") } : {}),
    ...(typeof node.primaryAxisAlignItems === "string" ? { justify: node.primaryAxisAlignItems.toLowerCase() } : {}),
    ...(typeof node.counterAxisAlignItems === "string" ? { align: node.counterAxisAlignItems.toLowerCase() } : {}),
  };
  return layout;
}

const STRUCTURAL_TYPES = new Set(["FRAME", "GROUP", "COMPONENT", "INSTANCE", "COMPONENT_SET", "SECTION"]);

/** Recursively flatten a raw Figma node tree into the Design Brief node subset. */
export function flattenFigmaNode(raw: Record<string, unknown>, out: BriefNode[] = []): BriefNode[] {
  if (out.length >= MAX_NODES) return out;
  const type = raw.type;
  const layout = layoutOf(raw);
  const isText = type === "TEXT" && typeof raw.characters === "string";
  // Keep structural containers (even without auto-layout) and text; skip decorative vectors/shapes.
  const isStructural = typeof type === "string" && STRUCTURAL_TYPES.has(type);
  if (isText || isStructural) {
    out.push({
      id: String(raw.id),
      ...(typeof raw.name === "string" ? { role: raw.name } : {}),
      ...(layout ? { layout } : {}),
      ...(isText ? { text: String(raw.characters) } : {}),
    });
  }
  if (Array.isArray(raw.children)) {
    for (const child of raw.children) {
      if (child && typeof child === "object") flattenFigmaNode(child as Record<string, unknown>, out);
    }
  }
  return out;
}

export interface TokensRef { readonly path: string; readonly sha256: string }

/** Compute the tokensRef for the code design tokens (source of truth). */
export function computeTokensRef(tokensPath = "cockpit/src/app/tokens.css"): TokensRef {
  const sha256 = createHash("sha256").update(readFileSync(join(repoRoot, tokensPath))).digest("hex");
  return { path: tokensPath, sha256 };
}

/** Assemble a schema-valid Design Brief skeleton with TODO intent/components to fill in. */
export function scaffoldBrief(source: Record<string, unknown>, nodes: BriefNode[], tokensRef: TokensRef): Record<string, unknown> {
  return {
    schemaVersion: "autopilot.design-brief/1",
    source,
    intent: {
      goal: "TODO: describe what this design should do",
      nonGoals: [],
      acceptanceCriteria: ["TODO: first acceptance criterion"],
    },
    tokensRef,
    nodes,
    components: [{ name: "TODO-ComponentName" }],
  };
}

async function fetchNode(ref: FigmaRef, token: string): Promise<Record<string, unknown>> {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, `${ref.fileKey}_${ref.nodeId.replace(":", "-")}.json`);
  const url = `https://api.figma.com/v1/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}`;
  const response = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!response.ok) {
    if (existsSync(cacheFile)) { console.error(`figma fetch ${response.status}; using cache`); return JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, unknown>; }
    const hint = response.status === 404
      ? " — file not found for this token. Community/template files must be duplicated into YOUR drafts first; also check the fileKey (l vs 1)."
      : response.status === 403 ? " — token lacks access to this file."
      : response.status === 401 ? " — invalid or expired FIGMA_TOKEN." : "";
    throw new Error(`Figma API ${response.status} ${response.statusText}${hint}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  writeFileSync(cacheFile, JSON.stringify(body));
  const doc = (body.nodes as Record<string, { document?: unknown }> | undefined)?.[ref.nodeId]?.document;
  if (!doc || typeof doc !== "object") throw new Error(`node ${ref.nodeId} not found in response`);
  return doc as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const brief = args.includes("--brief");
  const [a, b] = args.filter((arg) => arg !== "--brief");
  if (!a) { console.error("usage: tsx scripts/figma-fetch.ts [--brief] <figma-url> | <fileKey> <nodeId>"); process.exitCode = 1; return; }
  const token = process.env.FIGMA_TOKEN;
  if (!token) { console.error("FIGMA_TOKEN env var is required (Figma personal access token, read-only)"); process.exitCode = 1; return; }
  const ref = parseFigmaRef(a, b);
  const doc = await fetchNode(ref, token);
  const nodes = flattenFigmaNode(doc);
  const source = { provider: "figma", fileKey: ref.fileKey, nodeId: ref.nodeId, ...(a.includes("/") ? { url: a } : {}) };
  const output = brief ? scaffoldBrief(source, nodes, computeTokensRef()) : { source, nodes };
  console.log(JSON.stringify(output, null, 2));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  void main();
}
