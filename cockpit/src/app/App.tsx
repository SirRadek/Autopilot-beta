import React, { useEffect, useMemo, useState } from "react";
import { ControlPlaneApiError, createControlPlaneClient } from "../api/controlPlaneClient";
import { ApprovalPane } from "../features/approvals/ApprovalPane";
import { ProviderPane } from "../features/providers/ProviderPane";
import { SessionPane } from "../features/sessions/SessionPane";
import { WorkerPane } from "../features/workers/WorkerPane";
import { AppShell } from "./AppShell";
import { useRouteState } from "./routeState";
import { useCockpitData } from "./useCockpitData";
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
  const selectedProject = selectedSession ? { id: selectedSession.cwd, name: selectedSession.cwd } : route.projectId ? { id: route.projectId, name: route.projectId } : undefined;
  const chooseSession = (session: (typeof data.sessions)[number]) => setRoute({ projectId: session.cwd, sessionId: session.session_id });
  return <AppShell selectedProject={selectedProject} selectedSession={selectedSession ? { id: selectedSession.session_id, name: selectedSession.name ?? selectedSession.session_id, status: selectedSession.status === "active" ? "running" : "completed", agent: selectedSession.agent_command } : undefined}
    projectsPane={data.errors.sessions ? <p role="alert">Sessions unavailable: {data.errors.sessions.message}</p> : null}
    sessionsPane={<SessionPane sessions={data.sessions} selectedSessionId={route.sessionId} onSelect={chooseSession} onCreate={async (cwd) => { await client.createSession({ agent_command: "codex_cli", cwd: cwd ?? "/home/radek/autopilot-beta" }); await data.refresh(); }} onResume={async (session) => { await client.mutateSession(session.session_id, "resume"); await data.refresh(); }} onClose={async (session) => { await client.mutateSession(session.session_id, "close"); await data.refresh(); }} />}
    approvalPane={<ApprovalPane approvals={data.approvals} error={data.errors.approvals?.message} onApprove={async (approval) => { await client.decideApproval(approval.approval_id, "approved"); await data.refresh(); }} onReject={async (approval, reason) => { await client.decideApproval(approval.approval_id, "rejected", reason); await data.refresh(); }} />}
    operationsPane={<p aria-live="polite">{data.loading ? "Connecting to Control Plane…" : data.refreshing ? "Refreshing…" : data.errors.status ? `Status unavailable: ${data.errors.status.message}` : `${data.status?.telemetry.calls ?? 0} worker calls · ${data.status?.telemetry.total_tokens ?? 0} tokens`}</p>}
    workersPane={<WorkerPane workers={data.workers} error={data.errors.workers?.message} />}
    providersPane={<ProviderPane quotas={data.quotas} models={data.models} health={data.health} />}
    />;
}
