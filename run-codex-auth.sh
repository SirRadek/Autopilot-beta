#!/bin/bash
# Codex implements the ADDITIVE admin-login/auth phase (Claude planned + cross-reviewed).
# Writes files -> needs workspace-write, which requires --dangerously-bypass-approvals-and-sandbox
# here (bwrap has no unprivileged userns). Owner launches this; Claude cannot run the bypass flag.
# Run:
#   ! /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/run-codex-auth.sh
set -Eeuo pipefail
cd /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair
export PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH

SPEC=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-auth-impl-spec.md
LOG=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-auth-impl.log
: > "$LOG"

cat "$SPEC" | codex exec --dangerously-bypass-approvals-and-sandbox \
  -c model_reasoning_effort=high - >> "$LOG" 2>&1
code=${PIPESTATUS[1]}
echo "CODEX_EXIT=$code" >> "$LOG"

echo "===== HOTOVO: CODEX_EXIT=$code ====="
echo "--- nové/změněné soubory ---"
git -C /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair status --short || true
echo "(plný trace: $LOG)"
