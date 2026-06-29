#!/usr/bin/env sh

autopilot_hook_name() {
  basename "$0"
}

autopilot_fail() {
  code="$1"
  shift
  printf '\n[autopilot:%s] %s\n' "$(autopilot_hook_name)" "$*" >&2
  exit "$code"
}

autopilot_cd_root() {
  root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    autopilot_fail 1 "not inside a Git worktree"
  cd "$root" || autopilot_fail 1 "cannot cd to repository root: $root"
}

autopilot_npm() {
  if command -v npm.cmd >/dev/null 2>&1; then
    npm.cmd "$@"
  elif command -v npm >/dev/null 2>&1; then
    npm "$@"
  else
    autopilot_fail 127 "npm was not found on PATH"
  fi
}

autopilot_run_npm() {
  label="$1"
  shift
  printf '\n[autopilot:%s] %s\n' "$(autopilot_hook_name)" "$label"
  autopilot_npm "$@"
  status="$?"
  if [ "$status" -ne 0 ]; then
    autopilot_fail "$status" "$label failed; Git operation blocked."
  fi
}

autopilot_is_zero_sha() {
  [ "$1" = "0000000000000000000000000000000000000000" ]
}
