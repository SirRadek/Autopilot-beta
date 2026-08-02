import React, { useCallback, useEffect, useState } from "react";

import type { ControlPlaneClient } from "../../api/controlPlaneClient";
import type { FigmaMutationRecord } from "../../types/controlPlane";

export type FigmaMutationsPaneProps = { readonly client: ControlPlaneClient };

/** Pending Figma mutations: the owner approves/rejects a worker's proposal; approving
 *  returns a one-time lease to paste into the Figma plugin. */
export function FigmaMutationsPane({ client }: FigmaMutationsPaneProps) {
  const [records, setRecords] = useState<readonly FigmaMutationRecord[]>([]);
  const [lease, setLease] = useState<{ readonly id: string; readonly value: string }>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();

  const load = useCallback(async () => {
    try { setRecords(await client.listFigmaMutations()); setError(undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Načtení návrhů selhalo."); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (pending !== undefined) return;
    setPending(id);
    try {
      const record = await client.decideFigmaMutation(id, decision);
      if (decision === "approved" && record.lease) setLease({ id, value: record.lease });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rozhodnutí selhalo."); }
    finally { setPending(undefined); }
  };

  const pendingRecords = records.filter((record) => record.status === "pending");
  return <section className="figma-mutations" aria-label="Pending Figma mutations">
    <h3>Figma návrhy ke schválení</h3>
    <p className="fm-hint">Worker navrhl zápis do Figmy. Schválením vydáš jednorázový lease pro plugin; typed ops, version checkpoint a re-fetch verifikaci hlídá control plane.</p>
    {error ? <p role="alert" className="fm-error">{error}</p> : null}
    {pendingRecords.length === 0 ? <p className="fm-empty">Žádné návrhy ke schválení.</p> : <ul className="fm-list">
      {pendingRecords.map((record) => <li key={record.id} className="fm-item">
        <div className="fm-head"><span className="fm-id">{record.id}</span><span className="fm-file">{record.proposal.source.fileKey}</span></div>
        <p className="fm-ops">{record.proposal.ops.map((op) => op.op).join(" · ")}</p>
        {record.proposal.preview?.summary ? <p className="fm-summary">{record.proposal.preview.summary}</p> : null}
        <div className="fm-actions">
          <button type="button" className="fm-approve" disabled={pending !== undefined} onClick={() => void decide(record.id, "approved")}>Schválit</button>
          <button type="button" className="fm-reject" disabled={pending !== undefined} onClick={() => void decide(record.id, "rejected")}>Zamítnout</button>
        </div>
      </li>)}
    </ul>}
    {lease ? <div className="fm-lease" role="status">
      <p>Lease pro <span className="fm-id">{lease.id}</span> — vlož do pluginu (jednorázový, vázaný na file):</p>
      <code className="fm-lease-value">{lease.value}</code>
    </div> : null}
  </section>;
}
