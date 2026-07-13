import type { ApprovalRecord } from "../../types/controlPlane";

export type ApprovalState = ApprovalRecord["status"];

const rank: Record<ApprovalState, number> = { pending: 0, approved: 1, rejected: 2 };

export function sortApprovals(approvals: readonly ApprovalRecord[]): ApprovalRecord[] {
  return [...approvals].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const aDate = a.status === "pending" ? a.created_at : (a.decided_at ?? a.created_at);
    const bDate = b.status === "pending" ? b.created_at : (b.decided_at ?? b.created_at);
    return bDate.localeCompare(aDate) || a.approval_id.localeCompare(b.approval_id);
  });
}

export function boundedPromptPreview(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function approvalRisk(approval: ApprovalRecord): "low" | "medium" | "high" {
  if (approval.skill_ids.length >= 4 || approval.estimated_tokens >= 20_000) return "high";
  if (approval.skill_ids.length >= 2 || approval.estimated_tokens >= 5_000) return "medium";
  return "low";
}
