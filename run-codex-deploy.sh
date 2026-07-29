#!/bin/bash
# Deploy prep (step10) for merged SHA 9640e29 — Codex authors the cutover artifacts + candidate build,
# recomputes integrity hashes, and STOPS before any sudo. No sandbox (bwrap fails here).
# Spouštěj přes:
#   ! /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/run-codex-deploy.sh
set -Eeuo pipefail
cd /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair
export PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH

SPEC=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-deploy-spec.md
LOG=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-deploy.log
: > "$LOG"

cat "$SPEC" | codex exec --dangerously-bypass-approvals-and-sandbox - >> "$LOG" 2>&1
code=${PIPESTATUS[1]}
echo "CODEX_EXIT=$code" >> "$LOG"

echo "===== HOTOVO: CODEX_EXIT=$code ====="
echo "--- nové deploy skripty (step10) ---"
ls -la /home/radek/.local/bin/ | grep -iE "step10|control-plane-upgrade-step10" || echo "(žádné step10 nevytvořeno)"
ls -la /home/radek/.local/state/autopilot/ | grep -iE "step10" || true
echo "(plný trace: $LOG)"
