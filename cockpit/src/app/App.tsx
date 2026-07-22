import React, { useEffect, useMemo, useState } from "react";
import { ControlPlaneApiError, createControlPlaneClient } from "../api/controlPlaneClient";
import { ApprovalPane } from "../features/approvals/ApprovalPane";
import { ProviderPane } from "../features/providers/ProviderPane";
import { SessionPane } from "../features/sessions/SessionPane";
import { WorkerPane } from "../features/workers/WorkerPane";
import { IncidentPane } from "../features/incidents/IncidentPane";
import { RunComposer } from "../features/runs/RunComposer";
import { RunInspector } from "../features/runs/RunInspector";
import { PromotionPane } from "../features/promotion/PromotionPane";
import { BrainstormPane } from "../features/brainstorm/BrainstormPane";
import { AppShell } from "./AppShell";
import { useRouteState } from "./routeState";
import { useCockpitData, useRunTimeline } from "./useCockpitData";
import { LoginForm } from "../features/auth/LoginForm";
import { EnvironmentProvider } from "./environment";

export function App() {
  const client = useMemo(() => createControlPlaneClient(), []);
  const [authenticated, setAuthenticated] = useState<boolean | undefined>();
  const [authError, setAuthError] = useState<string>();
  useEffect(() => { client.getAuthSession().then(() => setAuthenticated(true)).catch((error: unknown) => { if (error instanceof ControlPlaneApiError && error.status === 401) setAuthenticated(false); else setAuthError(error instanceof Error ? error.message : "Control Plane není dostupný"); }); }, [client]);
  if (authenticated === undefined) return <main className="auth-page"><p role="status">Připojuji Control Plane…</p></main>;
  if (!authenticated) return <LoginForm error={authError} onLogin={async (token) => { await client.login(token); setAuthError(undefined); setAuthenticated(true); }} />;
  return <AuthenticatedCockpit client={client} />;
}

export function AuthenticatedCockpit({ client }: { readonly client: ReturnType<typeof createControlPlaneClient> }) {
  const [route, setRoute] = useRouteState();
  const data = useCockpitData(client, route.environment);
  const [budgetProvider, setBudgetProvider] = useState<string>();
  const selectedSession = data.sessions.find((session) => session.session_id === route.sessionId);
  const selectedRun = data.runs.find((run) => run.current.run_id === route.runId) ?? data.runs[0];
  const runTimeline = useRunTimeline(client, selectedRun?.worker_run_id ?? undefined);
  const registryProject = data.projects.find((project) => project.project_id === (selectedRun?.current.project_id ?? route.projectId));
  const selectedProject = selectedSession ? { id: selectedSession.cwd, name: selectedSession.cwd } : registryProject ? { id: registryProject.project_id, name: registryProject.name } : route.projectId ? { id: route.projectId, name: route.projectId } : undefined;
  const chooseSession = (session: (typeof data.sessions)[number]) => setRoute({ ...route, projectId: session.cwd, sessionId: session.session_id });
  const promotionPane = <PromotionPane
    packets={data.promotions}
    promotableRuns={route.environment === "dev" && selectedRun !== undefined ? [selectedRun] : []}
    onPromote={async (runId, input) => {
      const source = data.runs.find((run) => run.current.run_id === runId);
      if (route.environment !== "dev" || source?.status !== "completed" || source.current.profile !== "dev") throw new Error("promotion_source_not_completed");
      const packet = await client.promoteRun(runId, input);
      await data.refresh();
      return packet;
    }}
    onApprovePromotion={async (packetId) => {
      const packet = await client.approvePromotion(packetId, { approver: "owner", review_ref: `cockpit-owner:${packetId}` });
      await data.refresh();
      return packet;
    }}
    onRejectPromotion={async (packetId) => {
      const packet = await client.rejectPromotion(packetId);
      await data.refresh();
      return packet;
    }}
    onPrepareProdDraft={async (packetId) => {
      const packet = data.promotions.find((candidate) => candidate.packet_id === packetId);
      if (packet?.status !== "approved" || packet.full_verification_ref === null || !packet.approvals.some((approval) => approval.approver === "owner")) throw new Error("promotion_not_ready");
      const source = await client.getRun(packet.source_run_id);
      if (source.status !== "completed" || source.current.profile !== "dev" || source.current.revision !== packet.source_revision) throw new Error("promotion_source_mismatch");
      const draft = await client.createProdDraft(packet.packet_id, packet.full_verification_ref, {
        project_id: source.current.project_id,
        prompt: source.current.prompt,
        provider: source.current.provider,
        model: source.current.model,
        estimated_tokens: source.current.estimated_tokens,
        requested_artifacts: source.current.requested_artifacts,
        requested_reasoning_effort: source.current.requested_reasoning_effort,
        ...(source.current.prompt_review_acknowledged === undefined ? {} : { prompt_review_acknowledged: source.current.prompt_review_acknowledged }),
      });
      if (draft.status !== "draft" || draft.current.profile !== "prod" || draft.current.promotion_packet_id !== packet.packet_id || draft.worker_run_id !== null) throw new Error("invalid_prod_draft_response");
      setRoute({ ...route, environment: "prod", projectId: draft.current.project_id, runId: draft.current.run_id });
      await data.refresh();
      return draft;
    }}
  />;
  const brainstormPane = <BrainstormPane
    environment={route.environment}
    projects={data.projects}
    quotas={data.quotas}
    models={data.models}
    brainstorms={data.brainstorms}
    runs={data.runs}
    onCreate={async (input) => { const record = await client.createBrainstorm(input); await data.refresh(); return record; }}
    onApprove={async (id, operator) => { const record = await client.approveBrainstorm(id, operator); await data.refresh(); return record; }}
    onArbitrate={async (id, operator, route) => { const record = await client.arbitrateBrainstorm(id, operator, route); await data.refresh(); return record; }}
  />;
  return <EnvironmentProvider environment={route.environment}><AppShell environment={route.environment} onEnvironmentChange={(environment) => setRoute({ ...route, environment, runId: undefined })} selectedProject={selectedProject} selectedSession={selectedSession ? { id: selectedSession.session_id, name: selectedSession.name ?? selectedSession.session_id, status: selectedSession.status === "active" ? "running" : "completed", agent: selectedSession.agent_command } : undefined}
    runWorkspace={<>{route.environment === "dev" ? <RunComposer projects={data.projects} quotas={data.quotas} models={data.models} onPrepare={async (input) => { const run = await client.createDevRun(input); setRoute({ ...route, projectId: run.current.project_id, runId: run.current.run_id }); await data.refresh(); return run; }} onApprove={async (runId, revision) => { const run = await client.approveRun(runId, revision, "cockpit-operator"); setRoute({ ...route, projectId: run.current.project_id, runId }); await data.refresh(); return run; }} /> : null}{promotionPane}{data.runs.length ? <section className="run-picker" aria-label="Běhy"><h2>Běhy</h2>{data.runs.slice(0, 50).map((run) => <button type="button" key={run.current.run_id} aria-pressed={run.current.run_id === selectedRun?.current.run_id} onClick={() => setRoute({ ...route, projectId: run.current.project_id, runId: run.current.run_id })}>{run.current.run_id} · {run.status}</button>)}</section> : null}</>}
    runInspector={<>{runTimeline.error ? <p role="alert">Časová osa není dostupná: {runTimeline.error.message}</p> : null}<RunInspector run={selectedRun} timeline={runTimeline.data} /></>}
    incidentPane={<IncidentPane incidents={data.incidents} onAcknowledge={async (id) => { await client.acknowledgeIncident(id, "cockpit-operator"); await data.refresh(); }} onPrepareRepairPacket={(id) => { const incident = data.incidents.find((item) => item.incident_id === id); return client.prepareRepairPacket(id, { expected: incident?.impact ?? "Governed run completes without an internal incident", actual: incident?.summary ?? "Internal incident recorded" }); }} />}
    projectsPane={data.errors.sessions ? <p role="alert">Sessions unavailable: {data.errors.sessions.message}</p> : null}
    sessionsPane={<SessionPane sessions={data.sessions} selectedSessionId={route.sessionId} onSelect={chooseSession} onCreate={async (cwd) => { await client.createSession({ agent_command: "codex_cli", cwd: cwd ?? "/home/radek/autopilot-beta" }); await data.refresh(); }} onResume={async (session) => { await client.mutateSession(session.session_id, "resume"); await data.refresh(); }} onClose={async (session) => { await client.mutateSession(session.session_id, "close"); await data.refresh(); }} />}
    approvalPane={<ApprovalPane approvals={data.approvals} error={data.errors.approvals?.message} onApprove={async (approval) => { await client.decideApproval(approval.approval_id, "approved"); await data.refresh(); }} onReject={async (approval, reason) => { await client.decideApproval(approval.approval_id, "rejected", reason); await data.refresh(); }} />}
    operationsPane={<p aria-live="polite">{data.loading ? "Connecting to Control Plane…" : data.refreshing ? "Refreshing…" : data.errors.status ? `Status unavailable: ${data.errors.status.message}` : `${data.status?.telemetry.calls ?? 0} worker calls · ${data.status?.telemetry.total_tokens ?? 0} tokens`}</p>}
    workersPane={<WorkerPane workers={data.workers} error={data.errors.workers?.message} />}
    providersPane={<ProviderPane quotas={data.quotas} models={data.models} health={data.health} selectedProvider={budgetProvider} onSelectProvider={setBudgetProvider} />}
    brainstormPane={brainstormPane}
    /></EnvironmentProvider>;
}
