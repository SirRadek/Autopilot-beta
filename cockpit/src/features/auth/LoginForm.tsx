import React, { type FormEvent, useState } from "react";

export function LoginForm({ onLogin, error }: { readonly onLogin: (token: string) => Promise<void>; readonly error?: string }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setLocalError(undefined);
    try { await onLogin(token); setToken(""); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Přihlášení selhalo"); } finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit} aria-labelledby="login-title">
    <h1 id="login-title">Autopilot cockpit</h1>
    <p>Přihlášení vytvoří krátkodobou serverovou session. Token se neukládá do buildu ani localStorage.</p>
    <label htmlFor="control-plane-token">Control Plane token</label>
    <input id="control-plane-token" type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} required />
    {(localError ?? error) ? <p role="alert">{localError ?? error}</p> : null}
    <button type="submit" disabled={busy || token.length === 0}>{busy ? "Přihlašuji…" : "Přihlásit"}</button>
  </form></main>;
}
