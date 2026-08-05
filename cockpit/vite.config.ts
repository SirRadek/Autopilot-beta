import { defineConfig, loadEnv } from "vite";

const protectedPaths = ["/auth", "/ready", "/status", "/sessions", "/approvals", "/workers", "/providers", "/projects", "/runs", "/incidents", "/observability"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.CONTROL_PLANE_PROXY_TARGET ?? "http://127.0.0.1:8787";
  return {
    server: {
      proxy: Object.fromEntries(protectedPaths.map((path) => [path, { target, changeOrigin: false }]))
    },
    preview: {
      proxy: Object.fromEntries(protectedPaths.map((path) => [path, { target, changeOrigin: false }]))
    }
  };
});
