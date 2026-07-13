import React, { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectEntry, ProviderModels, ProviderQuota, RunDraftInput, RunProvider, RunRecord } from "../../types/controlPlane";
import { formatQuotaWindow } from "../providers/quotaSelectors";

export interface RunComposerProps {
  readonly projects: readonly ProjectEntry[];
  readonly quotas: readonly ProviderQuota[];
  readonly models?: ProviderModels;
  readonly onPrepare: (input: RunDraftInput) => Promise<RunRecord>;
  readonly onApprove: (runId: string, revision: number) => Promise<RunRecord>;
}

export function RunComposer({ projects, quotas, models, onPrepare, onApprove }: RunComposerProps) {
  const enabledProjects = projects.filter((project) => project.enabled);
  const [projectId, setProjectId] = useState(enabledProjects[0]?.project_id ?? "");
  const selectedProject = enabledProjects.find((project) => project.project_id === projectId);
  const [provider, setProvider] = useState(quotas[0]?.provider ?? "");
  useEffect(() => {
    if (!enabledProjects.some((project) => project.project_id === projectId)) setProjectId(enabledProjects[0]?.project_id ?? "");
    if (!quotas.some((candidate) => candidate.provider === provider)) setProvider(quotas[0]?.provider ?? "");
  }, [enabledProjects, projectId, provider, quotas]);
  const quota = quotas.find((candidate) => candidate.provider === provider);
  const routeFresh = quota?.freshness === "fresh" && models?.freshness === "fresh" && quota.health !== "unavailable";
  const availableModels = useMemo(() => {
    const catalog = (models?.models ?? []).filter((model) => model.providers.includes(provider) && model.available && !model.health.includes("unavailable"));
    return (quota?.models ?? []).filter((model) => model.available && model.health !== "unavailable" && catalog.some((candidate) => candidate.model_id === model.model_id));
  }, [models, provider, quota]);
  const [model, setModel] = useState("");
  const selectedModel = availableModels.some((candidate) => candidate.model_id === model) ? model : availableModels[0]?.model_id ?? "";
  const [prompt, setPrompt] = useState("");
  const [visual, setVisual] = useState(false);
  const [promptReviewAcknowledged, setPromptReviewAcknowledged] = useState(false);
  const [prepared, setPrepared] = useState<{ readonly record: RunRecord; readonly boundKey: string; readonly routeKey: string }>();
  const [pendingPrepareKeys, setPendingPrepareKeys] = useState<ReadonlySet<string>>(new Set());
  const [approvePending, setApprovePending] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const latestPrepare = useRef(0);
  const activePrepareKeys = useRef(new Set<string>());
  const approveActive = useRef(false);
  const estimatedTokens = estimateTokens(prompt);
  const input: RunDraftInput = { project_id: projectId, prompt, provider: provider as RunProvider, model: selectedModel || null, estimated_tokens: estimatedTokens, requested_artifacts: visual ? ["text", "visual"] : ["text"], ...(estimatedTokens > 1_000 ? { prompt_review_acknowledged: promptReviewAcknowledged } : {}) };
  const boundKey = JSON.stringify(input);
  const routeKey = JSON.stringify({ project: selectedProject ?? null, provider, selectedModel, quota: quota && { freshness: quota.freshness, health: quota.health, models: quota.models }, catalog: models && { freshness: models.freshness, models: models.models } });
  const currentBoundKey = useRef(boundKey); currentBoundKey.current = boundKey;
  const currentRouteKey = useRef(routeKey); currentRouteKey.current = routeKey;
  const previousRouteKey = useRef(routeKey);
  const invalidate = () => { generation.current += 1; setPrepared(undefined); setMessage(""); };
  useEffect(() => { if (previousRouteKey.current !== routeKey) { previousRouteKey.current = routeKey; invalidate(); } }, [routeKey]);
  const canPrepare = selectedProject !== undefined && prompt.trim() !== "" && estimatedTokens < 9_000 && (estimatedTokens <= 1_000 || promptReviewAcknowledged) && provider !== "" && routeFresh && selectedModel !== "" && !pendingPrepareKeys.has(boundKey);
  const validPrepared = prepared?.boundKey === boundKey && prepared.routeKey === routeKey ? prepared.record : undefined;

  async function prepare() {
    if (!canPrepare || activePrepareKeys.current.has(boundKey)) return;
    const request = ++latestPrepare.current; const requestGeneration = generation.current; const requestRoute = routeKey; const requestInput = input;
    activePrepareKeys.current.add(boundKey); setPendingPrepareKeys(new Set(activePrepareKeys.current)); setMessage("Příprava běhu…");
    try {
      const result = await onPrepare(requestInput);
      if (requestIsCurrent() && result.status !== "draft") { setMessage("Control Plane vrátil neplatný stav připraveného běhu."); return; }
      if (requestIsCurrent() && sameInput(result.current, requestInput)) { setPrepared({ record: result, boundKey, routeKey: requestRoute }); setMessage(`Revize ${result.current.revision} je připravena.`); }
    } catch (error) { if (requestIsCurrent()) setMessage(error instanceof Error ? error.message : "Příprava běhu selhala."); }
    finally { activePrepareKeys.current.delete(boundKey); setPendingPrepareKeys(new Set(activePrepareKeys.current)); }
    function requestIsCurrent() { return request === latestPrepare.current && requestGeneration === generation.current && requestRoute === currentRouteKey.current && boundKey === currentBoundKey.current; }
  }

  async function approve() {
    if (validPrepared === undefined || approveActive.current) return;
    approveActive.current = true; setApprovePending(true); setMessage("Schvalování běhu…");
    try { await onApprove(validPrepared.current.run_id, validPrepared.current.revision); setPrepared(undefined); generation.current += 1; setMessage("Běh byl schválen."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Schválení běhu selhalo."); }
    finally { approveActive.current = false; setApprovePending(false); }
  }

  return <section aria-label="Sestavení řízeného běhu">
    <label>Projekt<select aria-label="Projekt" value={projectId} onChange={(event) => { setProjectId(event.target.value); invalidate(); }}>{enabledProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
    <label>Poskytovatel<select aria-label="Poskytovatel" value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); invalidate(); }}>{quotas.map((candidate) => <option key={candidate.provider} value={candidate.provider} disabled={candidate.freshness !== "fresh" || candidate.health === "unavailable"}>{candidate.provider}</option>)}</select></label>
    <label>Model<select aria-label="Model" value={selectedModel} onChange={(event) => { setModel(event.target.value); invalidate(); }}>{availableModels.map((candidate) => <option key={candidate.model_id} value={candidate.model_id}>{candidate.model_id}</option>)}</select></label>
    {!routeFresh ? <p role="alert">Data poskytovatele nejsou aktuální. Příprava běhu je zakázána.</p> : null}
    <label>Prompt<textarea aria-label="Prompt" value={prompt} onChange={(event) => { setPrompt(event.target.value); invalidate(); }} /></label>
    {estimatedTokens > 1_000 ? <label><input type="checkbox" aria-label="Potvrdit ruční kontrolu promptu" checked={promptReviewAcknowledged} onChange={(event) => { setPromptReviewAcknowledged(event.target.checked); invalidate(); }} /> Potvrzuji ruční kontrolu promptu nad 1 000 tokenů</label> : null}
    {estimatedTokens >= 9_000 ? <p role="alert">Prompt překračuje pevný limit modelového kontextu.</p> : null}
    <label><input type="checkbox" aria-label="Vizuální výstup" checked={visual} onChange={(event) => { setVisual(event.target.checked); invalidate(); }} /> Vizuální výstup</label>
    <p>Odhad tokenů: {estimatedTokens.toLocaleString()}</p>
    {quota ? <dl><dt>5 hodin</dt><dd>{formatQuotaWindow(quota.five_hour)}</dd><dt>Týden</dt><dd>{formatQuotaWindow(quota.weekly)}</dd><dt>Útrata API</dt><dd>{quota.api_spend === null ? "Nedostupná" : `${quota.api_spend.toLocaleString()} ${quota.currency ?? ""}`.trim()}</dd></dl> : null}
    <button type="button" disabled={!canPrepare} onClick={() => void prepare()}>Připravit běh</button>
    <p aria-live="polite">{message}</p>
    {validPrepared ? <p>Revize {validPrepared.current.revision} připravena ke schválení</p> : null}
    <button type="button" disabled={validPrepared === undefined || validPrepared.status !== "draft" || validPrepared.current.revision < 1 || approvePending} onClick={() => void approve()}>Schválit a spustit</button>
  </section>;
}

function estimateTokens(prompt: string): number { return prompt.trim() === "" ? 0 : new TextEncoder().encode(prompt).length; }
function sameInput(draft: RunRecord["current"], input: RunDraftInput): boolean { return JSON.stringify({ project_id: draft.project_id, prompt: draft.prompt, provider: draft.provider, model: draft.model, estimated_tokens: draft.estimated_tokens, requested_artifacts: draft.requested_artifacts, prompt_review_acknowledged: draft.prompt_review_acknowledged === true }) === JSON.stringify({ ...input, prompt_review_acknowledged: input.prompt_review_acknowledged === true }); }
