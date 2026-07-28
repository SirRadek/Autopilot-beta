import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LoginForm", () => {
  it("submits username and password without retaining them after success", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onLogin = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<LoginForm onLogin={onLogin} />));
    const username = host.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    const password = host.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(username, "admin.owner");
      username.dispatchEvent(new Event("change", { bubbles: true }));
      setter?.call(password, "correct-password-value");
      password.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onLogin).toHaveBeenCalledWith({
      username: "admin.owner",
      password: "correct-password-value"
    });
    expect(username.value).toBe("");
    expect(password.value).toBe("");
    expect(host.textContent).toContain("nikde se neukládá");
    act(() => root.unmount());
    host.remove();
  });
});
