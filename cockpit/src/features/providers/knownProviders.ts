import type { RunProvider } from "../../types/controlPlane";

export const KNOWN_PROVIDERS = ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"] as const satisfies readonly RunProvider[];
