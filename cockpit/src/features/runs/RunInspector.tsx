import React from "react";
import type { ObservabilityTimeline, RunDraft, RunRecord } from "../../types/controlPlane";

const MAX_OUTPUT_CHARS = 4_000;
const MAX_ARTIFACTS = 24;
const MAX_EVENTS = 100;

export function RunInspector({ run, timeline }: { readonly run?: RunRecord; readonly timeline?: ObservabilityTimeline }) {
  if (!run) return <p className="run-empty">Vyberte běh pro zobrazení podrobností.</p>;
  const input = approvedInput(run);
  const output = run.provider_result?.raw_output ?? "";
  const outputTruncated = output.length > MAX_OUTPUT_CHARS;
  const artifacts = run.artifacts.slice(0, MAX_ARTIFACTS);
  const visualRequested = input.requested_artifacts.includes("visual");
  const visualAvailable = artifacts.some((artifact) => artifact.type === "visual");
  return <div className="run-inspector">
    <header className="run-inspector-heading"><div><span className={`run-state run-state-${run.status}`}>{run.status}</span><h2>{run.current.run_id}</h2></div><small>Revize {input.revision}</small></header>
    <section aria-labelledby="approved-input-heading"><h3 id="approved-input-heading">Schválený vstup</h3><dl className="run-facts"><div><dt>Projekt</dt><dd>{input.project_id}</dd></div><div><dt>Poskytovatel</dt><dd>{input.provider}</dd></div><div><dt>Model</dt><dd>{input.model ?? "výchozí"}</dd></div><div><dt>Odhad</dt><dd>{input.estimated_tokens} tokenů</dd></div></dl><pre>{input.prompt}</pre></section>
    <section aria-labelledby="evidence-heading"><h3 id="evidence-heading">Tokeny, cena a opakování</h3><p>{timeline?.summary.tokens ?? run.token_reservation?.totalTokens ?? 0} tokenů · {(timeline?.summary.openrouter_cost_usd ?? 0).toFixed(2)} USD · {timeline?.summary.retries ?? 0} opakování</p></section>
    <section aria-labelledby="timeline-heading"><h3 id="timeline-heading">Časová osa</h3><ol className="run-timeline">{timeline?.timeline.slice(0, MAX_EVENTS).map((event, index) => <li key={`${event.at}-${event.event}-${index}`}><time>{event.at}</time><strong>{event.event}</strong>{event.detail ? <span>{event.detail}</span> : null}</li>)}</ol>{timeline?.limits.truncated || (timeline?.timeline.length ?? 0) > MAX_EVENTS ? <p className="truncation-marker">Časová osa byla zkrácena.</p> : null}</section>
    <section aria-labelledby="output-heading"><h3 id="output-heading">Výstup</h3>{output ? <pre>{output.slice(0, MAX_OUTPUT_CHARS)}{outputTruncated ? "\n…" : ""}</pre> : <p>Výstup zatím není dostupný.</p>}{outputTruncated ? <p className="truncation-marker">Výstup byl zkrácen; úplný omezený záznam zůstává v uloženém artefaktu.</p> : null}</section>
    <section aria-labelledby="artifacts-heading"><h3 id="artifacts-heading">Artefakty</h3>{artifacts.map((artifact) => <article key={artifact.artifact_id}><strong>{artifact.type}</strong><p>{artifact.preview}</p></article>)}{run.artifacts.length > MAX_ARTIFACTS ? <p className="truncation-marker">Seznam artefaktů byl zkrácen.</p> : null}{visualRequested && !visualAvailable ? <p className="visual-unavailable">Vizuální výstup není dostupný pro tento běh.</p> : null}</section>
    {run.dispatch_failure || run.terminal_reason || run.provider_result?.reason ? <section aria-labelledby="run-error-heading"><h3 id="run-error-heading">Chyba běhu</h3><p>{run.dispatch_failure ?? run.terminal_reason ?? run.provider_result?.reason}</p></section> : null}
  </div>;
}

function approvedInput(run: RunRecord): RunDraft { return run.revisions.find((revision) => revision.revision === run.approved_revision) ?? run.current; }
