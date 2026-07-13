import React, { useEffect, useMemo, useState } from "react";
import { ControlPlaneApiError, createControlPlaneClient } from "../api/controlPlaneClient";
import { ApprovalPane } from "../features/approvals/ApprovalPane";
import { ProviderPane } from "../features/providers/ProviderPane";
import { SessionPane } from "../features/sessions/SessionPane";
import { WorkerPane } from "../features/workers/WorkerPane";
import { IncidentPane } from "../features/incidents/IncidentPane";
import { RunComposer } from "../features/runs/RunComposer";
import { RunInspector } from "../features/runs/RunInspector";
import { AppShell } from "./AppShell";
import { useRouteState } from "./routeState";
import { useCockpitData, useRunTimeline } from "./useCockpitData";
import { LoginForm } from "../features/auth/LoginForm";

export function App() {
  const client = useMemo(() => createControlPlaneClient(), []);
  const [authenticated, setAuthenticated] = useState<boolean | undefined>();
  const [authError, setAuthError] = useState<string>();
  useEffect(() => { client.getAuthSession().then(() => setAuthenticated(true)).catch((error: unknown) => { if (error instanceof ControlPlaneApiError && error.status === 401) setAuthenticated(false); else setAuthError(error instanceof Error ? error.message : "Control Plane není dostupný"); }); }, [client]);
  if (authenticated === undefined) return <main className="auth-page"><p role="status">Připojuji Control Plane…</p></main>;
  if (!authenticated) return <LoginForm error={authError} onLogin={async (token) => { await client.login(token); setAuthError(undefined); setAuthenticated(true); }} />;
  return <AuthenticatedCockpit client={client} />;
}

function AuthenticatedCockpit({ client }: { readonly client: ReturnType<typeof createControlPlaneClient> }) {
  const data = useCockpitData(client);
  const [route, setRoute] = useRouteState();
  const selectedSession = data.sessions.find((session) => session.session_id === route.sessionId);
  const selectedRun = data.runs.find((run) => run.current.run_id === route.runId) ?? data.runs[0];
  const runTimeline = useRunTimeline(client, selectedRun?.worker_run_id ?? undefined);
  const registryProject = data.projects.find((project) => project.project_id === (selectedRun?.current.project_id ?? route.projectId));
  const selectedProject = selectedSession ? { id: selectedSession.cwd, name: selectedSession.cwd } : registryProject ? { id: registryProject.project_id, name: registryProject.name } : route.projectId ? { id: route.projectId, name: route.projectId } : undefined;
  const chooseSession = (session: (typeof data.sessions)[number]) => setRoute({ ...route, projectId: session.cwd, sessionId: session.session_id });
  return <AppShell selectedProject={selectedProject} selectedSession={selectedSession ? { id: selectedSession.session_id, name: selectedSession.name ?? selectedSession.session_id, status: selectedSession.status === "active" ? "running" : "completed", agent: selectedSession.agent_command } : undefined}
    runWorkspace={<><RunComposer projects={data.projects} quotas={data.quotas} models={data.models} onPrepare={async (input) => { const run = await client.prepareRun(input); setRoute({ projectId: run.current.project_id, runId: run.current.run_id }); await data.refresh(); return run; }} onApprove={async (runId, revision) => { const run = await client.approveRun(runId, revision, "cockpit-operator"); setRoute({ projectId: run.current.project_id, runId }); await data.refresh(); return run; }} />{data.runs.length ? <section className="run-picker" aria-label="Běhy"><h2>Běhy</h2>{data.runs.slice(0, 50).map((run) => <button type="button" key={run.current.run_id} aria-pressed={run.current.run_id === selectedRun?.current.run_id} onClick={() => setRoute({ projectId: run.current.project_id, runId: run.current.run_id })}>{run.current.run_id} · {run.status}</button>)}</section> : null}</>}
    runInspector={<>{runTimeline.error ? <p role="alert">Časová osa není dostupná: {runTimeline.error.message}</p> : null}<RunInspector run={selectedRun} timeline={runTimeline.data} /></>}
    incidentPane={<IncidentPane incidents={data.incidents} onAcknowledge={async (id) => { await client.acknowledgeIncident(id, "cockpit-operator"); await data.refresh(); }} onPrepareRepairPacket={(id) => { const incident = data.incidents.find((item) => item.incident_id === id); return client.prepareRepairPacket(id, { expected: incident?.impact ?? "Governed run completes without an internal incident", actual: incident?.summary ?? "Internal incident recorded" }); }} />}
    projectsPane={data.errors.sessions ? <p role="alert">Sessions unavailable: {data.errors.sessions.message}</p> : null}
    sessionsPane={<SessionPane sessions={data.sessions} selectedSessionId={route.sessionId} onSelect={chooseSession} onCreate={async (cwd) => { await client.createSession({ agent_command: "codex_cli", cwd: cwd ?? "/home/radek/autopilot-beta" }); await data.refresh(); }} onResume={async (session) => { await client.mutateSession(session.session_id, "resume"); await data.refresh(); }} onClose={async (session) => { await client.mutateSession(session.session_id, "close"); await data.refresh(); }} />}
    approvalPane={<ApprovalPane approvals={data.approvals} error={data.errors.approvals?.message} onApprove={async (approval) => { await client.decideApproval(approval.approval_id, "approved"); await data.refresh(); }} onReject={async (approval, reason) => { await client.decideApproval(approval.approval_id, "rejected", reason); await data.refresh(); }} />}
    operationsPane={<p aria-live="polite">{data.loading ? "Connecting to Control Plane…" : data.refreshing ? "Refreshing…" : data.errors.status ? `Status unavailable: ${data.errors.status.message}` : `${data.status?.telemetry.calls ?? 0} worker calls · ${data.status?.telemetry.total_tokens ?? 0} tokens`}</p>}
    workersPane={<WorkerPane workers={data.workers} error={data.errors.workers?.message} />}
    providersPane={<ProviderPane quotas={data.quotas} models={data.models} health={data.health} />}
    />;
}
