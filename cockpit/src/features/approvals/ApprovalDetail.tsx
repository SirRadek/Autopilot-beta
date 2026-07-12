import React, { useState } from "react";
import type { ApprovalRecord } from "../../types/controlPlane";
import { approvalRisk, boundedPromptPreview } from "./approvalSelectors";

export type ApprovalDetailProps = {
  readonly approval: ApprovalRecord;
  readonly busy?: boolean;
  readonly error?: string;
  readonly auditResult?: string;
  readonly onApprove?: (approval: ApprovalRecord) => void | Promise<void>;
  readonly onReject?: (approval: ApprovalRecord, reason: string) => void | Promise<void>;
};

const tabs = ["Prompt", "Diff", "Files", "Plan", "Logs"] as const;
type DetailTab = (typeof tabs)[number];

export function ApprovalDetail({ approval, busy = false, error, auditResult, onApprove, onReject }: ApprovalDetailProps) {
  const [tab, setTab] = useState<DetailTab>("Prompt");
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const actionable = approval.status === "pending" && !busy;
  const confirmApprove = async () => { setConfirm(null); await onApprove?.(approval); };
  const confirmReject = async () => { if (!reason.trim()) return; setConfirm(null); await onReject?.(approval, reason.trim()); setReason(""); };
  const tabContent = tab === "Prompt" ? <pre className="approval-prompt">{boundedPromptPreview(approval.prompt_preview)}</pre> : <p className="approval-empty-detail">{tab} data is not available in the approval snapshot.</p>;
  return <article className="approval-detail" aria-label={`Approval ${approval.approval_id}`}>
    <header className="approval-detail-header"><div><h3>{approval.vendor}{approval.model ? ` / ${approval.model}` : ""}</h3><span className={`approval-risk approval-risk-${approvalRisk(approval)}`}>Risk: {approvalRisk(approval)}</span></div><span className={`approval-status approval-status-${approval.status}`}>{approval.status}</span></header>
    <dl className="approval-meta"><div><dt>Session</dt><dd>{approval.session_id}</dd></div><div><dt>Skills</dt><dd>{approval.skill_ids.length ? approval.skill_ids.join(", ") : "none"}</dd></div><div><dt>Estimated tokens</dt><dd>{approval.estimated_tokens.toLocaleString()}</dd></div><div><dt>Required checks</dt><dd>Governed route, active session</dd></div><div><dt>Stop conditions</dt><dd>Budget exceeded or stale session</dd></div></dl>
    <nav className="approval-detail-tabs" aria-label="Approval details" role="tablist">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <section role="tabpanel" aria-label={`${tab} details`}>{tabContent}</section>
    {error ? <p role="alert" className="approval-error">{error}</p> : null}{auditResult ? <p role="status" className="approval-audit">{auditResult}</p> : null}
    <div className="approval-actions"><button type="button" disabled={!actionable} aria-disabled={!actionable} onClick={() => setConfirm("approve")}>Approve</button><button type="button" disabled={!actionable} aria-disabled={!actionable} onClick={() => setConfirm("reject")}>Reject</button></div>
    {busy ? <p role="status">Saving decision…</p> : null}
    {confirm === "approve" ? <div className="approval-confirm" role="dialog" aria-label="Confirm approval"><p>Approve this prompt for dispatch?</p><button type="button" onClick={() => void confirmApprove()}>Confirm approve</button><button type="button" onClick={() => setConfirm(null)}>Cancel</button></div> : null}
    {confirm === "reject" ? <div className="approval-confirm" role="dialog" aria-label="Confirm rejection"><label>Reason <textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" disabled={!reason.trim()} onClick={() => void confirmReject()}>Confirm reject</button><button type="button" onClick={() => setConfirm(null)}>Cancel</button></div> : null}
  </article>;
}
