#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export function parseNodeMajor(version) {
  const match = /^v?(\d+)(?:\.|$)/.exec(version);
  return match ? Number(match[1]) : null;
}

export function requireNode24({
  version = process.versions.node,
  execPath = process.execPath,
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  if (parseNodeMajor(version) === 24) return;
  const message = `node24_required expected=>=24 <25 actual=${version} executable=${execPath}`;
  writeError(message);
  throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireNode24();
  } catch {
    process.exitCode = 64;
  }
}
