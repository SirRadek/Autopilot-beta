#!/bin/bash
# Codex generates the step11 deploy artifacts for a87da9f (both surfaces) + the auth
# provisioning helper, recomputes all integrity hashes, and STOPS before any sudo.
# Writes files -> workspace-write -> needs the bypass flag (bwrap has no userns here).
# Owner launches; Claude verifies every hash before any sudo cutover.
#   ! bash /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/run-codex-deploy-step11.sh
set -Eeuo pipefail
cd /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair
export PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH

SPEC=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-deploy-step11-spec.md
LOG=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-deploy-step11.log
: > "$LOG"

cat "$SPEC" | codex exec --dangerously-bypass-approvals-and-sandbox \
  -c model_reasoning_effort=high - >> "$LOG" 2>&1
code=${PIPESTATUS[1]}
echo "CODEX_EXIT=$code" >> "$LOG"

echo "===== HOTOVO: CODEX_EXIT=$code ====="
echo "--- step11 artefakty ---"
ls -la /home/radek/.local/bin/ | grep -iE "step11" || echo "(žádné step11 v bin)"
ls -la /home/radek/.local/state/autopilot/ | grep -iE "step11" || echo "(žádné step11 ve state)"
echo "(plný trace: $LOG)"
