import React, { useState } from "react";
import type { ApprovalRecord } from "../../types/controlPlane";
import { approvalRisk, approvalRiskLabel, approvalStateLabel, boundedPromptPreview } from "./approvalSelectors";

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
  const risk = approvalRisk(approval);
  const tabContent = tab === "Prompt" ? <pre className="approval-prompt">{boundedPromptPreview(approval.prompt_preview)}</pre> : <p className="approval-empty-detail">Data pro záložku {tab} nejsou ve snímku schválení dostupná.</p>;
  return <article className="approval-detail" aria-label={`Schválení ${approval.approval_id}`}>
    <header className="approval-detail-header"><div><h3>{approval.vendor}{approval.model ? ` / ${approval.model}` : ""}</h3><span className={`approval-risk approval-risk-${risk}`}>Riziko: {approvalRiskLabel(risk)}</span></div><span className={`approval-status approval-status-${approval.status}`}>{approvalStateLabel(approval.status)}</span></header>
    <dl className="approval-meta"><div><dt>Relace</dt><dd>{approval.session_id}</dd></div><div><dt>Skills</dt><dd>{approval.skill_ids.length ? approval.skill_ids.join(", ") : "žádné"}</dd></div><div><dt>Odhad tokenů</dt><dd>{approval.estimated_tokens.toLocaleString()}</dd></div><div><dt>Povinné kontroly</dt><dd>Řízená cesta, aktivní relace</dd></div><div><dt>Podmínky zastavení</dt><dd>Překročený rozpočet nebo zastaralá relace</dd></div></dl>
    <nav className="approval-detail-tabs" aria-label="Podrobnosti schválení" role="tablist">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <section role="tabpanel" aria-label={`Podrobnosti ${tab}`}>{tabContent}</section>
    {error ? <p role="alert" className="approval-error">{error}</p> : null}{auditResult ? <p role="status" className="approval-audit">{auditResult}</p> : null}
    <div className="approval-actions"><button type="button" disabled={!actionable} aria-disabled={!actionable} onClick={() => setConfirm("approve")}>Schválit</button><button type="button" disabled={!actionable} aria-disabled={!actionable} onClick={() => setConfirm("reject")}>Zamítnout</button></div>
    {busy ? <p role="status">Ukládám rozhodnutí…</p> : null}
    {confirm === "approve" ? <div className="approval-confirm" role="dialog" aria-label="Potvrdit schválení"><p>Schválit tento prompt ke spuštění?</p><button type="button" onClick={() => void confirmApprove()}>Potvrdit schválení</button><button type="button" onClick={() => setConfirm(null)}>Zrušit</button></div> : null}
    {confirm === "reject" ? <div className="approval-confirm" role="dialog" aria-label="Potvrdit zamítnutí"><label>Důvod <textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" disabled={!reason.trim()} onClick={() => void confirmReject()}>Potvrdit zamítnutí</button><button type="button" onClick={() => setConfirm(null)}>Zrušit</button></div> : null}
  </article>;
}
