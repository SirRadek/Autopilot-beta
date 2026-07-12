import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import axe from "axe-core";
import type { ApprovalRecord } from "../../types/controlPlane";
import { boundedPromptPreview, sortApprovals } from "./approvalSelectors";
import { ApprovalPane } from "./ApprovalPane";

const base: ApprovalRecord = { schema_version: "v1", approval_id: "a-1", session_id: "s-1", vendor: "claude_cli", model: "claude", skill_ids: ["model-usage"], prompt_preview: "show usage", prompt_file: null, estimated_tokens: 25, status: "pending", created_at: "2026-07-11T10:00:00.000Z", decided_at: null, rejection_reason: null };
function mount(node: React.ReactNode) { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(node)); return { host, root }; }

describe("approval selectors", () => {
  it("sorts pending first then newest decisions", () => { const result = sortApprovals([{ ...base, approval_id: "old", status: "approved", created_at: "2026-07-11T10:00:00.000Z", decided_at: "2026-07-11T08:00:00.000Z" }, { ...base, approval_id: "new", status: "approved", created_at: "2026-07-11T09:00:00.000Z", decided_at: "2026-07-11T11:00:00.000Z" }, { ...base, approval_id: "pending", created_at: "2026-07-11T07:00:00.000Z" }]); expect(result.map((item) => item.approval_id)).toEqual(["pending", "new", "old"]); });
  it("bounds prompt preview", () => { expect(boundedPromptPreview("x".repeat(600))).toHaveLength(500); expect(boundedPromptPreview("x".repeat(600)).endsWith("…")).toBe(true); });
});

describe("ApprovalPane", () => {
  it("renders queue and requires confirmation before approve", () => { const { host, root } = mount(<ApprovalPane approvals={[base]} />); expect(host.textContent).toContain("pending"); const approve = [...host.querySelectorAll("button")].find((button) => button.textContent === "Approve") as HTMLButtonElement; act(() => approve.click()); expect(host.textContent).toContain("Approve this prompt"); const confirm = [...host.querySelectorAll("button")].find((button) => button.textContent === "Confirm approve") as HTMLButtonElement; expect(confirm).not.toBeUndefined(); act(() => confirm.click()); act(() => root.unmount()); host.remove(); });
  it("requires a rejection reason and calls callback", () => { const calls: string[] = []; const { host, root } = mount(<ApprovalPane approvals={[base]} onReject={(_, reason) => calls.push(reason)} />); const reject = [...host.querySelectorAll("button")].find((button) => button.textContent === "Reject") as HTMLButtonElement; act(() => reject.click()); const confirm = [...host.querySelectorAll("button")].find((button) => button.textContent === "Confirm reject") as HTMLButtonElement; expect(confirm.disabled).toBe(true); const textarea = host.querySelector("textarea") as HTMLTextAreaElement; act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, "too risky"); textarea.dispatchEvent(new Event("change", { bubbles: true })); }); const enabledConfirm = [...host.querySelectorAll("button")].find((button) => button.textContent === "Confirm reject") as HTMLButtonElement; act(() => enabledConfirm.click()); expect(calls).toEqual(["too risky"]); act(() => root.unmount()); host.remove(); });
  it("renders detail tabs and API errors", () => { const { host, root } = mount(<ApprovalPane approvals={[base]} error="401 unauthorized" />); expect(host.textContent).toContain("401 unauthorized"); const tabs = [...host.querySelectorAll('[role="tab"]')]; act(() => (tabs[2] as HTMLButtonElement).click()); expect(host.textContent).toContain("Files data is not available"); act(() => root.unmount()); host.remove(); });
  it("renders conflict errors and disables stale mutations", () => { const { host, root } = mount(<ApprovalPane approvals={[{ ...base, status: "approved", decided_at: "2026-07-11T11:00:00.000Z" }]} error="409 approval already decided" />); expect(host.textContent).toContain("409 approval already decided"); expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Approve")?.disabled).toBe(true); act(() => root.unmount()); host.remove(); });
  it("has no axe violations", async () => { const { host, root } = mount(<ApprovalPane approvals={[base]} />); const result = await axe.run(host, { rules: { "color-contrast": { enabled: false } } }); expect(result.violations).toEqual([]); act(() => root.unmount()); host.remove(); });
});
