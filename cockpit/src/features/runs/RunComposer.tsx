import React, { useMemo, useState } from "react";

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
  const [provider, setProvider] = useState(quotas[0]?.provider ?? "");
  const quota = quotas.find((candidate) => candidate.provider === provider);
  const routeFresh = quota?.freshness === "fresh" && models?.freshness === "fresh";
  const availableModels = useMemo(() => {
    const quotaModels = quota?.models ?? [];
    const live = quotaModels.length ? quotaModels : (models?.models ?? []).filter((model) => model.providers.includes(provider));
    return live.filter((model) => model.available && model.health !== "unavailable" && !(Array.isArray(model.health) && model.health.includes("unavailable")));
  }, [models, provider, quota]);
  const [model, setModel] = useState("");
  const selectedModel = availableModels.some((candidate) => candidate.model_id === model) ? model : availableModels[0]?.model_id ?? "";
  const [prompt, setPrompt] = useState("");
  const [visual, setVisual] = useState(false);
  const [prepared, setPrepared] = useState<RunRecord>();
  const estimatedTokens = estimateTokens(prompt);
  const invalidate = () => setPrepared(undefined);
  const canPrepare = projectId !== "" && prompt.trim() !== "" && provider !== "" && routeFresh && (availableModels.length > 0 || quota?.models.length === 0);

  async function prepare() {
    if (!canPrepare) return;
    const result = await onPrepare({ project_id: projectId, prompt, provider: provider as RunProvider, model: selectedModel || null, estimated_tokens: estimatedTokens, requested_artifacts: visual ? ["text", "visual"] : ["text"] });
    setPrepared(result);
  }

  return <section aria-label="Sestavení řízeného běhu">
    <label>Projekt<select aria-label="Projekt" value={projectId} onChange={(event) => { setProjectId(event.target.value); invalidate(); }}>{enabledProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
    <label>Poskytovatel<select aria-label="Poskytovatel" value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); invalidate(); }}>{quotas.map((candidate) => <option key={candidate.provider} value={candidate.provider} disabled={candidate.freshness !== "fresh" || candidate.health === "unavailable"}>{candidate.provider}</option>)}</select></label>
    <label>Model<select aria-label="Model" value={selectedModel} onChange={(event) => { setModel(event.target.value); invalidate(); }}>{availableModels.map((candidate) => <option key={candidate.model_id} value={candidate.model_id}>{candidate.model_id}</option>)}</select></label>
    {!routeFresh ? <p role="alert">Data poskytovatele nejsou aktuální. Příprava běhu je zakázána.</p> : null}
    <label>Prompt<textarea aria-label="Prompt" value={prompt} onChange={(event) => { setPrompt(event.target.value); invalidate(); }} /></label>
    <label><input type="checkbox" aria-label="Vizuální výstup" checked={visual} onChange={(event) => { setVisual(event.target.checked); invalidate(); }} /> Vizuální výstup</label>
    <p>Odhad tokenů: {estimatedTokens.toLocaleString()}</p>
    {quota ? <dl><dt>5 hodin</dt><dd>{formatQuotaWindow(quota.five_hour)}</dd><dt>Týden</dt><dd>{formatQuotaWindow(quota.weekly)}</dd><dt>Útrata API</dt><dd>{quota.api_spend === null ? "Nedostupná" : `${quota.api_spend.toLocaleString()} ${quota.currency ?? ""}`.trim()}</dd></dl> : null}
    <button type="button" disabled={!canPrepare} onClick={() => void prepare()}>Připravit běh</button>
    {prepared ? <p>Revize {prepared.current.revision} připravena ke schválení</p> : null}
    <button type="button" disabled={prepared === undefined || prepared.status !== "draft" || prepared.current.revision < 1} onClick={() => prepared && void onApprove(prepared.current.run_id, prepared.current.revision)}>Schválit a spustit</button>
  </section>;
}

function estimateTokens(prompt: string): number { return prompt.trim() === "" ? 0 : Math.ceil(prompt.length / 4); }
