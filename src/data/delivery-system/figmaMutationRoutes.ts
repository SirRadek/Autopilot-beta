// HTTP surface for the governed Figma mutation lifecycle (write MVP phase 1b).
// Kept as an isolated module so figma_write_boundary tracks exactly the write
// surface, not the whole control-plane server. Workers may only submit; the
// owner approves (issuing a one-time lease); the plugin claims with that lease.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { MutationProposal } from "./figmaMutation";
import { FigmaMutationStore, type MutationResult } from "./figmaMutationStore";

const MAX_BODY_BYTES = 256 * 1024;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return {};
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return {}; }
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value, null, 2));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

/** Handle /figma/mutations routes. Returns true when it owns the request. */
export async function handleFigmaMutationRoute(request: IncomingMessage, response: ServerResponse, stateDir: string): Promise<boolean> {
  const url = request.url ?? "";
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith("/figma/mutations")) return false;
  const method = request.method;
  const store = new FigmaMutationStore(stateDir);

  if (method === "GET" && path === "/figma/mutations") { json(response, store.list()); return true; }

  if (method === "POST" && path === "/figma/mutations") {
    const body = await readJson(request);
    try { json(response, store.submit(body as unknown as MutationProposal), 201); }
    catch (error) { json(response, { error: "invalid_mutation_proposal", detail: messageOf(error) }, 400); }
    return true;
  }

  if (method === "POST" && path === "/figma/mutations/claim") {
    const body = await readJson(request);
    const fileKey = typeof body.fileKey === "string" ? body.fileKey : null;
    const lease = typeof body.lease === "string" ? body.lease : null;
    if (!fileKey || !lease) { json(response, { error: "invalid_claim" }, 400); return true; }
    try {
      const { record, ops } = store.claim(fileKey, lease);
      json(response, { id: record.id, fileKey, expectedVersion: record.proposal.expectedVersion, ops });
    } catch { json(response, { error: "invalid_or_expired_lease" }, 403); }
    return true;
  }

  const parts = path.split("/"); // ["", "figma", "mutations", id, action?]
  const id = parts[3];

  if (method === "POST" && id && parts[4] === "result") {
    const body = await readJson(request);
    const result: MutationResult = {
      ...(Array.isArray(body.node_ids) ? { node_ids: (body.node_ids as unknown[]).filter((node): node is string => typeof node === "string") } : {}),
      ...(typeof body.digest === "string" ? { digest: body.digest } : {}),
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    };
    try { json(response, store.recordResult(id, result)); }
    catch (error) { json(response, { error: messageOf(error) }, 409); }
    return true;
  }

  if (method === "POST" && id && parts[4] === "verify") {
    const body = await readJson(request);
    try { json(response, store.verify(id, { ok: body.ok === true, ...(typeof body.diff === "string" ? { diff: body.diff } : {}) })); }
    catch (error) { json(response, { error: messageOf(error) }, 409); }
    return true;
  }

  if (method === "POST" && id && parts.length === 4) {
    const body = await readJson(request);
    const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
    const approver = typeof body.approver === "string" ? body.approver : "cockpit-operator";
    if (decision === null) { json(response, { error: "invalid_mutation_decision" }, 400); return true; }
    try {
      if (decision === "approved") {
        const { record, lease } = store.approve(id, approver);
        json(response, { ...record, lease });
      } else {
        json(response, store.reject(id, approver, typeof body.reason === "string" ? body.reason : undefined));
      }
    } catch (error) {
      const message = messageOf(error);
      json(response, { error: message }, message === "mutation_not_pending" ? 409 : 400);
    }
    return true;
  }

  json(response, { error: "not_found" }, 404);
  return true;
}
