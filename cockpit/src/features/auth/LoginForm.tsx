import React, { type FormEvent, useState } from "react";
import type { AdminLoginCredentials } from "../../api/controlPlaneClient";

export function LoginForm({ onLogin, error }: { readonly onLogin: (credentials: AdminLoginCredentials) => Promise<void>; readonly error?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setLocalError(undefined);
    try { await onLogin({ username, password }); setUsername(""); setPassword(""); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Přihlášení selhalo"); } finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit} aria-labelledby="login-title">
    <h1 id="login-title">Autopilot cockpit</h1>
    <p>Přihlášení vytvoří serverovou session. Heslo: nikde se neukládá v prohlížeči, buildu ani localStorage.</p>
    <label htmlFor="admin-username">Uživatelské jméno</label>
    <input id="admin-username" type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
    <label htmlFor="admin-password">Heslo</label>
    <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
    {(localError ?? error) ? <p role="alert">{localError ?? error}</p> : null}
    <button type="submit" disabled={busy || username.length === 0 || password.length === 0}>{busy ? "Přihlašuji…" : "Přihlásit"}</button>
  </form></main>;
}
