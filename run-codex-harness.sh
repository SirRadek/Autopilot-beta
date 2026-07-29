#!/bin/bash
# Codex fixes the deploy acceptance harness for the new username/password login (Claude planned).
# Writes files -> workspace-write -> needs the bypass flag (bwrap has no userns here).
#   ! bash /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/run-codex-harness.sh
set -Eeuo pipefail
cd /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair
export PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH

SPEC=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-harness-fix-spec.md
LOG=/tmp/claude-1000/-home-radek/ffc20e3a-b6d3-42fb-8e7a-5d822b7bd906/scratchpad/codex-harness.log
: > "$LOG"

cat "$SPEC" | codex exec --dangerously-bypass-approvals-and-sandbox \
  -c model_reasoning_effort=high - >> "$LOG" 2>&1
code=${PIPESTATUS[1]}
echo "CODEX_EXIT=$code" >> "$LOG"

echo "===== HOTOVO: CODEX_EXIT=$code ====="
echo "--- změněné soubory ---"
git -C /home/radek/projects/autopilot-beta-worktrees/release-baseline-repair status --short
echo "(plný trace: $LOG)"
