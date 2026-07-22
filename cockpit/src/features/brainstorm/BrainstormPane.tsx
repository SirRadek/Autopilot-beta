import React, { useEffect, useRef, useState } from "react";

import type { BrainstormArbitrationInput, BrainstormDraftInput, BrainstormRecord, BrainstormRouteDraft, ProjectEntry, ProviderModels, ProviderQuota, RunProvider, RunReasoningEffort, RunRecord } from "../../types/controlPlane";
import type { CockpitEnvironment } from "../../app/environment";

const CONSOLIDATION_TOKENS = 10_000;
const ARBITRATION_TOKENS = 8_000;
const OUTPUT_ALLOWANCE = 8_192;
const ARBITRATION_OPT_OUT = "__opt_out__";
const NO_REASONING = "__no_reasoning__";
const KNOWN_PROVIDERS: readonly RunProvider[] = ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"];

type ReasoningSelection = RunReasoningEffort | typeof NO_REASONING | "";

interface ConsolidationSummary {
  readonly consensus?: readonly string[];
  readonly confidence?: number;
}

function parseConsolidationSummary(raw: string): ConsolidationSummary | undefined {
  if (raw === "" || raw.length > 20_000) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const consensus = Array.isArray(record.consensus) && record.consensus.length <= 64 && record.consensus.every((item) => typeof item === "string" && item.length <= 2000)
    ? (record.consensus as readonly string[])
    : undefined;
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence) && record.confidence >= 0 && record.confidence <= 1
    ? record.confidence
    : undefined;
  if (consensus === undefined && confidence === undefined) return undefined;
  return { consensus, confidence };
}

export interface BrainstormPaneProps {
  readonly environment: CockpitEnvironment;
  readonly projects: readonly ProjectEntry[];
  readonly quotas: readonly ProviderQuota[];
  readonly models?: ProviderModels;
  readonly brainstorms: readonly BrainstormRecord[];
  readonly runs: readonly RunRecord[];
  readonly onCreate: (input: BrainstormDraftInput) => Promise<BrainstormRecord>;
  readonly onApprove: (id: string, operator: string) => Promise<BrainstormRecord>;
  readonly onArbitrate: (id: string, operator: string, route: BrainstormArbitrationInput) => Promise<BrainstormRecord>;
  readonly onCancel?: (id: string) => Promise<BrainstormRecord>;
}

const CANCELLABLE_STATUSES: readonly BrainstormRecord["status"][] = ["draft", "approved", "fanout_running", "consolidating"];

function estimateBriefTokens(brief: string): number {
  return brief.trim() === "" ? 0 : new TextEncoder().encode(brief).length;
}

function availableModelsFor(provider: string, quota: ProviderQuota | undefined, models: ProviderModels | undefined) {
  const catalog = (models?.models ?? []).filter((model) => model.providers.includes(provider) && model.available && !model.health.includes("unavailable"));
  return (quota?.models ?? []).filter((model) => model.available && model.health !== "unavailable" && catalog.some((candidate) => candidate.model_id === model.model_id));
}

function reasoningEffortsFor(provider: string, modelId: string, models: ProviderModels | undefined): readonly RunReasoningEffort[] {
  const entry = (models?.models ?? []).find((candidate) => candidate.model_id === modelId && candidate.providers.includes(provider));
  return entry?.provider_routes?.find((route) => route.provider === provider)?.reasoning_efforts ?? [];
}

export function BrainstormPane({ environment, projects, quotas, models, brainstorms, runs, onCreate, onApprove, onArbitrate, onCancel }: BrainstormPaneProps) {
  const enabledProjects = projects.filter((project) => project.enabled);
  const [projectId, setProjectId] = useState(enabledProjects[0]?.project_id ?? "");
  useEffect(() => { if (!enabledProjects.some((project) => project.project_id === projectId)) setProjectId(enabledProjects[0]?.project_id ?? ""); }, [enabledProjects, projectId]);

  const eligibleQuotas = quotas.filter((quota) => quota.freshness === "fresh" && quota.health !== "unavailable" && KNOWN_PROVIDERS.includes(quota.provider as RunProvider));

  const [brief, setBrief] = useState("");
  const [routeModel, setRouteModel] = useState<Record<string, string>>({});
  const [routeReasoning, setRouteReasoning] = useState<Record<string, ReasoningSelection>>({});
  const [synthesizer, setSynthesizer] = useState("");
  const [arbitrationProvider, setArbitrationProvider] = useState("");
  const [arbitrationModel, setArbitrationModel] = useState("");
  const [arbitrationReasoning, setArbitrationReasoning] = useState<ReasoningSelection>("");
  const [ackMaxTokens, setAckMaxTokens] = useState(false);

  const [prepared, setPrepared] = useState<{ readonly record: BrainstormRecord; readonly key: string }>();
  const [message, setMessage] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [approvePending, setApprovePending] = useState(false);
  const [confirmArbitrationId, setConfirmArbitrationId] = useState<string>();
  const [arbitratePending, setArbitratePending] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string>();
  const [cancelPendingId, setCancelPendingId] = useState<string>();
  const [cancelError, setCancelError] = useState<{ readonly id: string; readonly message: string }>();
  const generation = useRef(0);
  const createActive = useRef(false);
  const approveActive = useRef(false);
  const arbitrateActive = useRef(false);
  const cancelActive = useRef(false);

  function resolveReasoning(selection: ReasoningSelection, efforts: readonly RunReasoningEffort[]): { readonly value: RunReasoningEffort | null; readonly explicit: boolean } {
    if (efforts.length === 0) return { value: null, explicit: selection === NO_REASONING };
    return { value: selection === "" || selection === NO_REASONING ? null : selection, explicit: selection !== "" && selection !== NO_REASONING };
  }

  const routes = eligibleQuotas.map((quota) => {
    const provider = quota.provider as RunProvider;
    const model = routeModel[provider] ?? "";
    const efforts = model ? reasoningEffortsFor(provider, model, models) : [];
    const reasoning = resolveReasoning(routeReasoning[provider] ?? "", efforts);
    return {
      provider,
      model,
      requested_reasoning_effort: reasoning.value,
      reasoningExplicit: reasoning.explicit,
      estimated_tokens: estimateBriefTokens(brief) + OUTPUT_ALLOWANCE,
    };
  });

  const routesComplete = routes.length >= 3 && routes.length <= 4 && routes.every((route) => route.model !== "" && route.reasoningExplicit);
  const arbitrationEfforts = arbitrationModel ? reasoningEffortsFor(arbitrationProvider, arbitrationModel, models) : [];
  const arbitrationReasoningResolved = resolveReasoning(arbitrationReasoning, arbitrationEfforts);
  const arbitrationRoute: BrainstormRouteDraft | null = arbitrationProvider === "" || arbitrationProvider === ARBITRATION_OPT_OUT ? null : { provider: arbitrationProvider as RunProvider, model: arbitrationModel, requested_reasoning_effort: arbitrationReasoningResolved.value };
  const arbitrationDecided = arbitrationProvider === ARBITRATION_OPT_OUT || (arbitrationProvider !== "" && arbitrationModel !== "" && arbitrationReasoningResolved.explicit);

  const fanoutTokens = routes.reduce((sum, route) => sum + route.estimated_tokens, 0);
  const estimatedTokens = fanoutTokens + CONSOLIDATION_TOKENS + (arbitrationRoute ? ARBITRATION_TOKENS : 0);
  const maximumTokens = estimatedTokens;
  const minimumTokens = arbitrationRoute ? maximumTokens - Math.floor(maximumTokens / (routes.length + 2)) : maximumTokens;

  const draftInput: BrainstormDraftInput | undefined = projectId !== "" && brief.trim() !== "" && routesComplete && synthesizer !== "" && arbitrationDecided
    ? {
        project_id: projectId,
        brief,
        routes: routes.map(({ provider, model, requested_reasoning_effort }) => ({ provider, model, requested_reasoning_effort })),
        synthesizer: synthesizer as RunProvider,
        estimated_tokens: maximumTokens,
        arbitration_route: arbitrationRoute,
      }
    : undefined;

  const boundKey = draftInput ? JSON.stringify(draftInput) : "";
  const otherMutationPending = createPending || approvePending || arbitratePending;
  const anyMutationPending = otherMutationPending || cancelPendingId !== undefined;
  const canCreate = environment === "dev" && draftInput !== undefined && !anyMutationPending;
  const validPrepared = prepared?.key === boundKey ? prepared.record : undefined;

  const invalidate = () => { generation.current += 1; setPrepared(undefined); setAckMaxTokens(false); setMessage(""); };

  const previousBoundKey = useRef(boundKey);
  useEffect(() => { if (previousBoundKey.current !== boundKey) { previousBoundKey.current = boundKey; invalidate(); } }, [boundKey]);

  async function create() {
    if (!canCreate || draftInput === undefined || createActive.current) return;
    createActive.current = true; setCreatePending(true); setMessage("Připravuji brainstorm…");
    const requestGeneration = generation.current; const requestKey = boundKey;
    try {
      const record = await onCreate(draftInput);
      if (requestGeneration === generation.current && requestKey === boundKey) {
        if (record.status !== "draft") { setMessage("Control Plane vrátil neplatný stav brainstormu."); return; }
        setPrepared({ record, key: requestKey });
        setMessage(`Brainstorm ${record.brainstorm_id} je připraven.`);
      }
    } catch (error) {
      if (requestGeneration === generation.current) setMessage(error instanceof Error ? error.message : "Příprava brainstormu selhala.");
    } finally {
      createActive.current = false; setCreatePending(false);
    }
  }

  async function approve() {
    if (validPrepared === undefined || !ackMaxTokens || approveActive.current) return;
    approveActive.current = true; setApprovePending(true); setMessage("Spouštím fan-out…");
    try {
      await onApprove(validPrepared.brainstorm_id, "cockpit-operator");
      setPrepared(undefined); generation.current += 1;
      setMessage("Fan-out byl spuštěn.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Spuštění fan-outu selhalo.");
    } finally {
      approveActive.current = false; setApprovePending(false);
    }
  }

  async function confirmArbitrate(record: BrainstormRecord) {
    if (environment !== "dev" || arbitrateActive.current || cancelPendingId !== undefined || record.arbitration_route === null) return;
    if (confirmArbitrationId !== record.brainstorm_id) { setConfirmArbitrationId(record.brainstorm_id); return; }
    arbitrateActive.current = true; setArbitratePending(true); setMessage("Volám arbitráž…");
    const route: BrainstormArbitrationInput = { provider: record.arbitration_route.provider, model: record.arbitration_route.model, reasoning_effort: record.arbitration_route.reasoning_effort, estimated_tokens: record.arbitration_route.estimated_tokens };
    try {
      await onArbitrate(record.brainstorm_id, "cockpit-operator", route);
      setMessage("Arbitráž byla vyvolána.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Arbitráž selhala.");
    } finally {
      arbitrateActive.current = false; setArbitratePending(false); setConfirmArbitrationId(undefined);
    }
  }

  async function confirmCancel(record: BrainstormRecord) {
    if (environment !== "dev" || onCancel === undefined || cancelActive.current || otherMutationPending || !CANCELLABLE_STATUSES.includes(record.status)) return;
    if (confirmCancelId !== record.brainstorm_id) { setConfirmCancelId(record.brainstorm_id); setCancelError(undefined); return; }
    cancelActive.current = true; setCancelPendingId(record.brainstorm_id); setCancelError(undefined);
    try {
      await onCancel(record.brainstorm_id);
    } catch (error) {
      setCancelError({ id: record.brainstorm_id, message: error instanceof Error ? error.message : "Zrušení brainstormu selhalo." });
    } finally {
      cancelActive.current = false; setCancelPendingId(undefined); setConfirmCancelId(undefined);
    }
  }

  const projectBrainstorms = brainstorms.filter((record) => record.project_id === projectId);
  const runsById = new Map(runs.map((run) => [run.current.run_id, run]));

  return (
    <section aria-label="Brainstorm" className="brainstorm-pane">
      <h2>Brainstorm</h2>
      {environment !== "dev" ? <p className="provider-warning" role="status">PROD je pouze pro čtení. Brainstorm lze vytvořit pouze v DEV.</p> : null}
      <label>Projekt<select aria-label="Brainstorm projekt" value={projectId} disabled={environment !== "dev"} onChange={(event) => { setProjectId(event.target.value); invalidate(); }}>
        {enabledProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}
      </select></label>
      {environment === "dev" ? <>
        <label>Brief<textarea aria-label="Brief" value={brief} disabled={anyMutationPending} onChange={(event) => { setBrief(event.target.value); invalidate(); }} /></label>
        <div className="brainstorm-routes">
          {eligibleQuotas.map((quota) => {
            const provider = quota.provider;
            const model = routeModel[provider] ?? "";
            const availableModels = availableModelsFor(provider, quota, models);
            const reasoningEfforts = model ? reasoningEffortsFor(provider, model, models) : [];
            return (
              <fieldset key={provider} className="worker-card brainstorm-route-card" aria-label={`Route ${provider}`}>
                <legend>{provider}</legend>
                <label>Model<select aria-label={`Model ${provider}`} value={model} disabled={anyMutationPending} onChange={(event) => { setRouteModel({ ...routeModel, [provider]: event.target.value }); setRouteReasoning({ ...routeReasoning, [provider]: "" }); invalidate(); }}>
                  <option value="">Vyberte model</option>
                  {availableModels.map((candidate) => <option key={candidate.model_id} value={candidate.model_id}>{candidate.model_id}</option>)}
                </select></label>
                <label>Reasoning<select aria-label={`Reasoning ${provider}`} value={routeReasoning[provider] ?? ""} disabled={anyMutationPending || !model} onChange={(event) => { setRouteReasoning({ ...routeReasoning, [provider]: event.target.value as ReasoningSelection }); invalidate(); }}>
                  <option value="">Vyberte reasoning</option>
                  {reasoningEfforts.length === 0 ? <option value={NO_REASONING}>Bez reasoning (poskytovatel nepodporuje)</option> : null}
                  {reasoningEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                </select></label>
              </fieldset>
            );
          })}
        </div>
        {eligibleQuotas.length < 3 ? <p role="alert">Nedostatek ověřených poskytovatelů pro brainstorm (nutné 3–4).</p> : null}
        <label>Syntezátor<select aria-label="Syntezátor" value={synthesizer} disabled={anyMutationPending} onChange={(event) => { setSynthesizer(event.target.value); invalidate(); }}>
          <option value="">Vyberte syntezátora</option>
          {eligibleQuotas.map((quota) => <option key={quota.provider} value={quota.provider}>{quota.provider}</option>)}
        </select></label>
        <fieldset aria-label="Arbitráž">
          <legend>Arbitráž (předem určená)</legend>
          <label>Arbitr<select aria-label="Arbitr" value={arbitrationProvider} disabled={anyMutationPending} onChange={(event) => { setArbitrationProvider(event.target.value); setArbitrationModel(""); setArbitrationReasoning(""); invalidate(); }}>
            <option value="">Vyberte arbitra</option>
            {eligibleQuotas.map((quota) => <option key={quota.provider} value={quota.provider}>{quota.provider}</option>)}
            <option value={ARBITRATION_OPT_OUT}>Bez arbitráže (opt-out)</option>
          </select></label>
          {arbitrationProvider !== "" && arbitrationProvider !== ARBITRATION_OPT_OUT ? <>
            <label>Model arbitra<select aria-label="Model arbitra" value={arbitrationModel} disabled={anyMutationPending} onChange={(event) => { setArbitrationModel(event.target.value); setArbitrationReasoning(""); invalidate(); }}>
              <option value="">Vyberte model</option>
              {availableModelsFor(arbitrationProvider, eligibleQuotas.find((quota) => quota.provider === arbitrationProvider), models).map((candidate) => <option key={candidate.model_id} value={candidate.model_id}>{candidate.model_id}</option>)}
            </select></label>
            <label>Reasoning arbitra<select aria-label="Reasoning arbitra" value={arbitrationReasoning} disabled={anyMutationPending || !arbitrationModel} onChange={(event) => { setArbitrationReasoning(event.target.value as ReasoningSelection); invalidate(); }}>
              <option value="">Vyberte reasoning</option>
              {arbitrationEfforts.length === 0 ? <option value={NO_REASONING}>Bez reasoning (poskytovatel nepodporuje)</option> : null}
              {arbitrationEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </select></label>
          </> : null}
          {arbitrationProvider === ARBITRATION_OPT_OUT ? <p className="provider-warning" role="alert">Bez arbitra: materiální konflikty selžou uzavřeně (brainstorm_no_independent_arbiter).</p> : null}
        </fieldset>
        <p>{minimumTokens.toLocaleString("cs-CZ")}–{maximumTokens.toLocaleString("cs-CZ")} tokenů</p>
        <p>Doporučení: žádné (shadow-only)</p>
        <button type="button" disabled={!canCreate} onClick={() => void create()}>Připravit brainstorm</button>
        <p aria-live="polite">{message}</p>
        {validPrepared ? <>
          <p>Brainstorm {validPrepared.brainstorm_id} připraven ke schválení</p>
          <p>Uložený rozsah: {validPrepared.token_envelope.minimum_tokens.toLocaleString("cs-CZ")}–{validPrepared.token_envelope.maximum_tokens.toLocaleString("cs-CZ")} tokenů</p>
          <label><input type="checkbox" aria-label="Potvrzuji maximální tokenový rozsah" checked={ackMaxTokens} disabled={anyMutationPending} onChange={(event) => setAckMaxTokens(event.target.checked)} /> Potvrzuji maximální tokenový rozsah</label>
          <button type="button" disabled={!ackMaxTokens || anyMutationPending} onClick={() => void approve()}>Spustit fan-out</button>
        </> : null}
      </> : null}
      <div className="brainstorm-list">
        <h3>Brainstormy projektu</h3>
        {projectBrainstorms.map((record) => (
          <article key={record.brainstorm_id} className="incident-pane brainstorm-record" aria-label={`Brainstorm ${record.brainstorm_id}`}>
            <header><strong>{record.brainstorm_id}</strong><span>{record.status}</span></header>
            {environment === "dev" && onCancel !== undefined && CANCELLABLE_STATUSES.includes(record.status) ? (
              confirmCancelId === record.brainstorm_id ? (
                <div role="group" aria-label={`Potvrdit zrušení ${record.brainstorm_id}`}>
                  <span>Zrušit tento brainstorm?</span>
                  <button type="button" disabled={cancelPendingId === record.brainstorm_id || otherMutationPending} onClick={() => void confirmCancel(record)}>{cancelPendingId === record.brainstorm_id ? "Ruším…" : "Potvrdit zrušení"}</button>
                  <button type="button" disabled={cancelPendingId === record.brainstorm_id} onClick={() => setConfirmCancelId(undefined)}>Ponechat</button>
                </div>
              ) : (
                <button type="button" disabled={anyMutationPending} onClick={() => void confirmCancel(record)}>Zrušit brainstorm</button>
              )
            ) : null}
            {cancelError?.id === record.brainstorm_id ? <p role="alert">{cancelError.message}</p> : null}
            <p>{record.token_envelope.minimum_tokens.toLocaleString("cs-CZ")}–{record.token_envelope.maximum_tokens.toLocaleString("cs-CZ")} tokenů</p>
            <ul>
              {record.child_run_ids.map((runId) => {
                const run = runsById.get(runId);
                return (
                  <li key={runId}>
                    <p>{run ? `${run.current.provider} · ${run.current.model ?? "?"}` : runId}</p>
                    <pre>{(run?.artifacts[0]?.preview ?? run?.provider_result?.raw_output ?? "").slice(0, 500)}</pre>
                  </li>
                );
              })}
            </ul>
            {(() => {
              const consolidationRun = record.consolidation_run_id ? runsById.get(record.consolidation_run_id) : undefined;
              const rawConsolidation = consolidationRun?.artifacts[0]?.preview ?? consolidationRun?.provider_result?.raw_output ?? "";
              const summary = record.consolidation_run_id ? parseConsolidationSummary(rawConsolidation) : undefined;
              return (
                <section aria-label="Konsenzus a jistota">
                  <h4>Konsenzus</h4>
                  {summary?.consensus ? <ul>{summary.consensus.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Konsenzus nedostupný</p>}
                  <h4>Jistota</h4>
                  {summary?.confidence !== undefined ? <p>{Math.round(summary.confidence * 100)} %</p> : <p>Jistota nedostupná</p>}
                </section>
              );
            })()}
            {record.conflicts.length ? <section aria-label="Konflikty">
              <h4>Konflikty</h4>
              <ul>{record.conflicts.map((conflict) => <li key={conflict.conflict_id}>{conflict.summary}{conflict.material ? " (materiální)" : ""}</li>)}</ul>
            </section> : null}
            {record.status === "needs_arbitration" && record.arbitration_route ? <section aria-label="Precommitted arbiter">
              <p>Předem určený arbitr: {record.arbitration_route.provider} · {record.arbitration_route.model}</p>
              {environment === "dev" ? (
                <button type="button" disabled={anyMutationPending} onClick={() => void confirmArbitrate(record)}>
                  {confirmArbitrationId === record.brainstorm_id ? "Potvrdit arbitráž" : "Vyvolat arbitráž"}
                </button>
              ) : null}
            </section> : null}
            {record.final_artifact !== null ? <section aria-label="Výsledek">
              <h4>Výsledný artefakt</h4>
              <pre>{record.final_artifact}</pre>
              <p>Provenience: {[...record.child_run_ids, record.consolidation_run_id, record.arbitration_run_id].filter((id): id is string => id !== null).join(", ")}</p>
            </section> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
