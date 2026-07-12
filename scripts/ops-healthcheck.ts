const port = Number(process.argv[2] ?? "8787");
const timeout = AbortSignal.timeout(5_000);
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: timeout });
  const body = await response.json() as { ok?: unknown };
  if (!response.ok || body.ok !== true) throw new Error("unhealthy_response");
  console.log(JSON.stringify({ ok: true, endpoint: `127.0.0.1:${port}` }));
} catch (error) {
  console.error(`control_plane_healthcheck_failed:${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
}
