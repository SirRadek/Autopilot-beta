import React, { useRef, useState } from "react";

import type { PromotionDraftInput, PromotionPacket, RunRecord } from "../../types/controlPlane";

export interface PromotionPaneProps {
  readonly packets: readonly PromotionPacket[];
  readonly promotableRuns?: readonly RunRecord[];
  readonly onPromote: (runId: string, input: PromotionDraftInput) => Promise<PromotionPacket>;
  readonly onApprovePromotion: (packetId: string) => Promise<PromotionPacket>;
  readonly onRejectPromotion: (packetId: string) => Promise<PromotionPacket>;
  readonly onPrepareProdDraft: (packetId: string) => Promise<RunRecord>;
}

export function PromotionPane({ packets, promotableRuns = [], onPromote, onApprovePromotion, onRejectPromotion, onPrepareProdDraft }: PromotionPaneProps) {
  const mutationActive = useRef(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const mutate = (operation: () => Promise<unknown>) => {
    if (mutationActive.current) return;
    mutationActive.current = true;
    setMutationPending(true);
    setMutationError("");
    void operation().catch((error: unknown) => setMutationError(error instanceof Error ? error.message.slice(0, 300) : "Akce propagace selhala.")).finally(() => {
      mutationActive.current = false;
      setMutationPending(false);
    });
  };
  return <section aria-label="Propagace do PROD">
    {mutationError ? <p role="alert">Akce propagace selhala: {mutationError}</p> : null}
    <h2>Propagovatelné běhy</h2>
    {promotableRuns.filter((run) => run.status === "completed").map((run) => <PromoteRunForm key={run.current.run_id} run={run} disabled={mutationPending} onMutate={mutate} onPromote={onPromote} />)}
    <h2>Propagační balíčky</h2>
    <ul>
      {packets.map((packet) => <li key={packet.packet_id}><PromotionPacketRow packet={packet} disabled={mutationPending} onMutate={mutate} onApprovePromotion={onApprovePromotion} onRejectPromotion={onRejectPromotion} onPrepareProdDraft={onPrepareProdDraft} /></li>)}
    </ul>
  </section>;
}

function PromoteRunForm({ run, disabled, onMutate, onPromote }: { readonly run: RunRecord; readonly disabled: boolean; readonly onMutate: (operation: () => Promise<unknown>) => void; readonly onPromote: PromotionPaneProps["onPromote"] }) {
  const [intent, setIntent] = useState("Publish");
  const [diffSummary, setDiffSummary] = useState("");
  const [tests, setTests] = useState("");
  const [risks, setRisks] = useState("");
  return <p>
    {run.current.run_id}
    <button type="button" disabled={disabled} onClick={() => onMutate(() => onPromote(run.current.run_id, { intent, diff_summary: diffSummary, tests: tests.split(",").map((item) => item.trim()).filter(Boolean), risks: risks.split(",").map((item) => item.trim()).filter(Boolean) }))}>Propagovat</button>
    <label>Záměr<input aria-label={`Záměr ${run.current.run_id}`} value={intent} onChange={(event) => setIntent(event.target.value)} /></label>
    <label>Shrnutí diffu<input aria-label={`Shrnutí diffu ${run.current.run_id}`} value={diffSummary} onChange={(event) => setDiffSummary(event.target.value)} /></label>
    <label>Testy<input aria-label={`Testy ${run.current.run_id}`} value={tests} onChange={(event) => setTests(event.target.value)} /></label>
    <label>Rizika<input aria-label={`Rizika ${run.current.run_id}`} value={risks} onChange={(event) => setRisks(event.target.value)} /></label>
  </p>;
}

function PromotionPacketRow({ packet, disabled, onMutate, onApprovePromotion, onRejectPromotion, onPrepareProdDraft }: { readonly packet: PromotionPacket; readonly disabled: boolean; readonly onMutate: (operation: () => Promise<unknown>) => void; readonly onApprovePromotion: PromotionPaneProps["onApprovePromotion"]; readonly onRejectPromotion: PromotionPaneProps["onRejectPromotion"]; readonly onPrepareProdDraft: PromotionPaneProps["onPrepareProdDraft"] }) {
  const canPrepareProdDraft = packet.status === "approved" && packet.full_verification_ref !== null && packet.approvals.some((approval) => approval.approver === "owner");
  return <>
    <p>{packet.status}</p>
    <p>{packet.intent}</p>
    <p>{packet.artifact_ref}</p>
    <p>Schválení: {packet.approvals.length}</p>
    <p>Důkaz plné verifikace: {packet.full_verification_ref ?? "chybí"}</p>
    {packet.status === "published" ? <>
      <p>PROD běh: {packet.prod_run_id}</p>
      <p>Přijetí vydání: {packet.release_acceptance_ref}</p>
      <p>Rollback: {packet.rollback_ref}</p>
    </> : null}
    {packet.status === "promotion_pending" ? <>
      <button type="button" disabled={disabled} onClick={() => onMutate(() => onApprovePromotion(packet.packet_id))}>Schválit propagaci</button>
      <button type="button" disabled={disabled} onClick={() => onMutate(() => onRejectPromotion(packet.packet_id))}>Odmítnout</button>
    </> : null}
    {packet.status === "approved" ? <button type="button" disabled={disabled || !canPrepareProdDraft} onClick={() => onMutate(() => onPrepareProdDraft(packet.packet_id))}>Připravit PROD draft</button> : null}
  </>;
}
