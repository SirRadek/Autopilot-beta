import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface DocumentationLinkReport {
  readonly checked_files: readonly string[];
  readonly errors: readonly string[];
}

export const CANONICAL_DOCUMENTS = [
  "README.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/user/cockpit-guide.md",
  "docs/architecture/system-overview.md",
  "docs/operations/install-ubuntu-vm.md",
  "docs/operations/configuration.md",
  "docs/operations/service-runbook.md",
  "docs/operations/state-and-recovery.md",
  "docs/operations/troubleshooting.md",
  "docs/status/current-status.md"
] as const;

const MAX_DOCUMENTATION_FILE_BYTES = 1_048_576;
const INDEX_DOCUMENTS = ["README.md", "docs/README.md"] as const;
const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*\]\(([^)\n]+)\)/g;

interface ScannedDocument {
  readonly anchors: ReadonlySet<string>;
  readonly links: readonly string[];
}

export function checkDocumentationLinks(
  root: string,
  canonicalDocuments: readonly string[] = CANONICAL_DOCUMENTS
): DocumentationLinkReport {
  const repositoryRoot = resolve(root);
  const checkedFiles = [...new Set(canonicalDocuments.map(normalizeRepoPath))].sort();
  const canonicalSet = new Set(checkedFiles);
  const documents = new Map<string, ScannedDocument>();
  const errors: string[] = [];

  for (const file of checkedFiles) {
    const absolutePath = resolve(repositoryRoot, file);
    if (!isWithinRoot(repositoryRoot, absolutePath) || !existsSync(absolutePath)) {
      errors.push(`canonical_document_missing:${file}`);
      continue;
    }
    const status = statSync(absolutePath);
    if (!status.isFile()) {
      errors.push(`canonical_document_missing:${file}`);
      continue;
    }
    if (status.size > MAX_DOCUMENTATION_FILE_BYTES) {
      errors.push(`documentation_file_too_large:${file}`);
      continue;
    }
    documents.set(file, scanMarkdown(readFileSync(absolutePath, "utf8")));
  }

  const linkedCanonicalByIndex = new Map<string, Set<string>>();
  for (const [source, document] of [...documents]) {
    const canonicalLinks = new Set<string>();
    for (const rawTarget of document.links) {
      const target = resolveLocalTarget(repositoryRoot, source, rawTarget);
      if (target === null) continue;
      if (target.outsideRoot) {
        errors.push(`local_link_outside_root:${source}:${target.display}`);
        continue;
      }
      if (!existsSync(target.absolutePath) || !statSync(target.absolutePath).isFile()) {
        errors.push(`broken_local_link:${source}:${target.path}`);
        continue;
      }
      if (canonicalSet.has(target.path)) canonicalLinks.add(target.path);
      if (target.anchor !== null) {
        let targetDocument = documents.get(target.path);
        if (targetDocument === undefined) {
          const targetStatus = statSync(target.absolutePath);
          if (targetStatus.size > MAX_DOCUMENTATION_FILE_BYTES) {
            errors.push(`documentation_file_too_large:${target.path}`);
            continue;
          }
          targetDocument = scanMarkdown(readFileSync(target.absolutePath, "utf8"));
          documents.set(target.path, targetDocument);
        }
        if (targetDocument === undefined || !targetDocument.anchors.has(target.anchor)) {
          errors.push(`broken_local_anchor:${source}:${target.path}#${target.anchor}`);
        }
      }
    }
    if ((INDEX_DOCUMENTS as readonly string[]).includes(source)) {
      linkedCanonicalByIndex.set(source, canonicalLinks);
    }
  }

  for (const canonicalPath of checkedFiles) {
    if (INDEX_DOCUMENTS.some((index) => index !== canonicalPath &&
      !linkedCanonicalByIndex.get(index)?.has(canonicalPath))) {
      errors.push(`canonical_document_not_linked:${canonicalPath}`);
    }
  }

  return {
    checked_files: checkedFiles,
    errors: [...new Set(errors)].sort()
  };
}

function scanMarkdown(markdown: string): ScannedDocument {
  const visibleMarkdown = withoutFencedCode(markdown);
  const anchors = headingAnchors(visibleMarkdown);
  const links: string[] = [];
  for (const match of visibleMarkdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const target = parseLinkDestination(match[1] ?? "");
    if (target !== null) links.push(target);
  }
  return { anchors, links };
}

function withoutFencedCode(markdown: string): string {
  const visible: string[] = [];
  let fence: "```" | "~~~" | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```|~~~)/)?.[1] as "```" | "~~~" | undefined;
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence === null) visible.push(line);
  }
  return visible.join("\n");
}

function headingAnchors(markdown: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading === undefined) continue;
    const base = githubHeadingSlug(heading);
    const duplicate = counts.get(base) ?? 0;
    counts.set(base, duplicate + 1);
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
  }
  return anchors;
}

function githubHeadingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseLinkDestination(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end < 0 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/, 1)[0] ?? null;
}

function resolveLocalTarget(
  repositoryRoot: string,
  source: string,
  rawTarget: string
): {
  readonly absolutePath: string;
  readonly anchor: string | null;
  readonly display: string;
  readonly outsideRoot: boolean;
  readonly path: string;
} | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(rawTarget) || rawTarget.startsWith("//")) return null;
  const hashIndex = rawTarget.indexOf("#");
  const rawPath = (hashIndex < 0 ? rawTarget : rawTarget.slice(0, hashIndex)).split("?", 1)[0] ?? "";
  const rawAnchor = hashIndex < 0 ? null : rawTarget.slice(hashIndex + 1);
  let decodedPath: string;
  let decodedAnchor: string | null;
  try {
    decodedPath = decodeURIComponent(rawPath);
    decodedAnchor = rawAnchor === null ? null : decodeURIComponent(rawAnchor).toLowerCase();
  } catch {
    decodedPath = rawPath;
    decodedAnchor = rawAnchor?.toLowerCase() ?? null;
  }
  const sourceDirectory = dirname(resolve(repositoryRoot, source));
  const absolutePath = decodedPath.length === 0
    ? resolve(repositoryRoot, source)
    : resolve(sourceDirectory, decodedPath);
  const path = normalizeRepoPath(relative(repositoryRoot, absolutePath));
  return {
    absolutePath,
    anchor: decodedAnchor === "" ? null : decodedAnchor,
    display: rawTarget,
    outsideRoot: !isWithinRoot(repositoryRoot, absolutePath),
    path
  };
}

function isWithinRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function runCli(): void {
  const report = checkDocumentationLinks(process.cwd());
  if (report.errors.length === 0) {
    console.log(`Documentation link validation passed: ${report.checked_files.length} canonical file(s).`);
    return;
  }
  console.error(`Documentation link validation failed: ${report.errors.length} error(s).`);
  for (const error of report.errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) runCli();
