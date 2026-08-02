// Autopilot Figma executor — main sandbox code.
// Receives an OWNER-APPROVED, already-claimed batch of typed ops from the UI,
// takes a named version-history checkpoint, applies the closed op allowlist via
// the Figma Plugin API, and returns created/changed node ids. It never talks to
// the control plane directly (the UI does) and never receives a PAT.
figma.showUI(__html__, { width: 380, height: 460 });

// Give the UI the current file key so it can claim the right batch.
figma.ui.postMessage({ type: "fileKey", fileKey: figma.fileKey || "" });

function parsePx(value) {
  if (typeof value !== "string") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

async function applyOp(op) {
  const args = op.args || {};
  switch (op.op) {
    case "createFrame": {
      const frame = figma.createFrame();
      frame.name = String(args.name || "Frame");
      const layout = args.layout || {};
      if (layout.direction === "row" || layout.direction === "column") {
        frame.layoutMode = layout.direction === "row" ? "HORIZONTAL" : "VERTICAL";
        if (layout.gap) frame.itemSpacing = parsePx(layout.gap);
        if (layout.padding) {
          const p = String(layout.padding).split(/\s+/).map(parsePx);
          frame.paddingTop = p[0] || 0; frame.paddingRight = p[1] != null ? p[1] : p[0] || 0;
          frame.paddingBottom = p[2] != null ? p[2] : p[0] || 0; frame.paddingLeft = p[3] != null ? p[3] : (p[1] != null ? p[1] : p[0] || 0);
        }
      }
      figma.currentPage.appendChild(frame);
      return { op: op.op, status: "applied", nodeId: frame.id };
    }
    case "setText": {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      let node = op.target ? figma.currentPage.findOne((n) => n.id === op.target || n.name === op.target) : null;
      if (!node || node.type !== "TEXT") { const t = figma.createText(); t.name = op.target || "text"; figma.currentPage.appendChild(t); node = t; }
      node.characters = String(args.text || "");
      return { op: op.op, status: "applied", nodeId: node.id };
    }
    case "verificationFrame": {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      const frame = figma.createFrame();
      frame.name = "✓ " + String(args.label || "verification");
      frame.layoutMode = "VERTICAL"; frame.paddingTop = 8; frame.paddingBottom = 8; frame.paddingLeft = 8; frame.paddingRight = 8;
      const label = figma.createText(); label.characters = String(args.label || "verification"); frame.appendChild(label);
      figma.currentPage.appendChild(frame);
      return { op: op.op, status: "applied", nodeId: frame.id };
    }
    case "addComment": {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      const note = figma.createText(); note.name = "comment"; note.characters = "💬 " + String(args.text || ""); figma.currentPage.appendChild(note);
      return { op: op.op, status: "applied", nodeId: note.id };
    }
    case "applyTokens": {
      // Token VALUES live in code (source of truth); the brief carries references only.
      // Record the referenced token names on the target node for the design system to resolve.
      const node = op.target ? figma.currentPage.findOne((n) => n.id === op.target || n.name === op.target) : null;
      if (node) node.setPluginData("autopilot.tokenRefs", JSON.stringify(args.tokens || []));
      return { op: op.op, status: node ? "recorded" : "skipped", nodeId: node ? node.id : undefined };
    }
    case "createVariant":
    case "placeImage":
      // Need a component definition / image bytes — deferred to a later phase.
      return { op: op.op, status: "deferred" };
    default:
      return { op: op.op, status: "rejected_unknown_op" };
  }
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "apply") return;
  const ops = Array.isArray(msg.ops) ? msg.ops : [];
  try {
    // Free rollback: a named checkpoint in Figma's own version history before any write.
    if (figma.saveVersionHistoryAsync) { try { await figma.saveVersionHistoryAsync("autopilot pre-batch " + (msg.batchId || "")); } catch (e) {} }
    const results = [];
    for (const op of ops) { results.push(await applyOp(op)); }
    figma.ui.postMessage({ type: "applied", results });
  } catch (error) {
    figma.ui.postMessage({ type: "applied", results: [], error: String(error && error.message ? error.message : error) });
  }
};
