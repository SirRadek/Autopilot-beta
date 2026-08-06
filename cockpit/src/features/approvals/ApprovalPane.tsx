import React, { useEffect, useState } from "react";
import type { ApprovalRecord } from "../../types/controlPlane";
import { ApprovalDetail } from "./ApprovalDetail";
import { approvalStateLabel, boundedPromptPreview, czechApprovalCount, czechPendingApprovalCount, sortApprovals } from "./approvalSelectors";

export type ApprovalPaneProps = {
  readonly approvals: readonly ApprovalRecord[];
  readonly selectedApprovalId?: string;
  readonly onSelect?: (approval: ApprovalRecord) => void;
  readonly onApprove?: (approval: ApprovalRecord) => void | Promise<void>;
  readonly onReject?: (approval: ApprovalRecord, reason: string) => void | Promise<void>;
  readonly busyApprovalId?: string;
  readonly error?: string;
  readonly auditResult?: string;
};

export function ApprovalPane({ approvals, selectedApprovalId, onSelect, onApprove, onReject, busyApprovalId, error, auditResult }: ApprovalPaneProps) {
  const sorted = sortApprovals(approvals);
  const [localId, setLocalId] = useState(selectedApprovalId ?? sorted[0]?.approval_id);
  useEffect(() => { if (selectedApprovalId !== undefined) setLocalId(selectedApprovalId); else if (!sorted.some((item) => item.approval_id === localId)) setLocalId(sorted[0]?.approval_id); }, [selectedApprovalId, sorted, localId]);
  const selected = sorted.find((item) => item.approval_id === localId) ?? sorted[0];
  const select = (approval: ApprovalRecord) => { setLocalId(approval.approval_id); onSelect?.(approval); };
  const pendingCount = sorted.filter((item) => item.status === "pending").length;
  return <div className="approval-pane"><div className="approval-queue-header"><span>{czechApprovalCount(sorted.length)}</span><span>{czechPendingApprovalCount(pendingCount)}</span></div>
    {sorted.length === 0 ? <p className="approval-empty">Žádné požadavky ke schválení.</p> : <ul className="approval-queue" aria-label="Fronta schválení">{sorted.map((approval) => <li key={approval.approval_id}><button type="button" className={approval.approval_id === selected?.approval_id ? "approval-row selected" : "approval-row"} aria-current={approval.approval_id === selected?.approval_id ? "true" : undefined} onClick={() => select(approval)}><span className="approval-row-title">{approval.vendor}{approval.model ? ` / ${approval.model}` : ""}</span><span className={`approval-row-status approval-status-${approval.status}`}>{approvalStateLabel(approval.status)}</span><span className="approval-row-preview">{boundedPromptPreview(approval.prompt_preview, 120)}</span><span className="approval-row-tokens">{approval.estimated_tokens.toLocaleString()} tokens</span></button></li>)}</ul>}
    {selected ? <ApprovalDetail approval={selected} busy={busyApprovalId === selected.approval_id} error={error} auditResult={auditResult} onApprove={onApprove} onReject={onReject} /> : null}
  </div>;
}
