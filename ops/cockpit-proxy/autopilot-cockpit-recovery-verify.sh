#!/bin/bash
set -Eeuo pipefail

if [ "${AUTOPILOT_CUTOVER_TEST_MODE:-0}" = 1 ]; then PATH="${AUTOPILOT_CUTOVER_TEST_BIN:?}:/usr/bin:/bin"; else PATH=/usr/sbin:/usr/bin:/sbin:/bin; fi
export PATH
[ "$#" -eq 2 ] || exit 64
environment="$1"
installation="$2"
source_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
node_bin=/usr/bin/node
if [ "${AUTOPILOT_CUTOVER_TEST_MODE:-0}" = 1 ]; then node_bin="${AUTOPILOT_NODE_BIN:?}"; fi

[ -f "$environment" ] && [ ! -L "$environment" ] || exit 1
state_dir="$(sed -n 's/^AUTOPILOT_STATE_DIR=//p' "$environment")"
projects_dir="$(sed -n 's/^AUTOPILOT_PROJECTS_DIR=//p' "$environment")"
[[ "$state_dir" =~ ^/[A-Za-z0-9._/-]+$ && "$projects_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || exit 1

work="$(mktemp -d /tmp/.autopilot-recovery-verify.XXXXXXXX)"
trap 'rm -rf -- "$work"' EXIT
health_status="$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 5 --output "$work/health.json" --write-out '%{http_code}' http://127.0.0.1:8787/health)"
ready_status="$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 5 --output "$work/ready.json" --write-out '%{http_code}' http://127.0.0.1:8787/ready)"
[ "$health_status:$ready_status" = 200:200 ]
HEALTH="$work/health.json" READY="$work/ready.json" "$node_bin" -e '
const fs=require("fs"),h=JSON.parse(fs.readFileSync(process.env.HEALTH)),r=JSON.parse(fs.readFileSync(process.env.READY));
if(h?.ok!==true||r?.ready!==true)process.exit(1);
for(const n of ["configuration","managed_state","project_registry","supervisor","token_gateway"])
 if(r?.components?.[n]?.status!=="ready"||r.components[n].error_code!==null)process.exit(1);'

listener="$(ss -H -ltn 'sport = :8787')"
[ "$(printf '%s\n' "$listener" | sed '/^$/d' | wc -l)" -eq 1 ]
[[ "$listener" == *"127.0.0.1:8787"* && "$listener" != *"0.0.0.0:8787"* && "$listener" != *"[::]:8787"* ]]

systemd-run --quiet --pipe --wait --collect \
	--property=User=radek --property=ProtectSystem=strict \
	--property="ReadOnlyPaths=$installation" --property="ReadWritePaths=$state_dir $projects_dir" \
	/bin/bash -c 'set -Eeuo pipefail; s="$1/.recovery-boundary-$$"; p="$2/.recovery-boundary-$$"; i="$3/.recovery-boundary-$$"; trap '\''rm -f "$s" "$p" "$i"'\'' EXIT; : > "$s"; : > "$p"; if : > "$i" 2>/dev/null; then exit 1; fi' -- "$state_dir" "$projects_dir" "$installation"

if [ "${AUTOPILOT_CUTOVER_TEST_MODE:-0}" = 1 ]; then
	[ "${STUB_RECOVERY_VERIFIER_FAIL:-0}" = 0 ] || exit 1
	smoke='{"mode":"dry-run","provider_invoked":false,"run_status":"completed","reservation_status":"settled","approved_revisions":1,"reservations":1,"supervisor_tasks":1,"worker_results":1}'
else
	smoke="$("$node_bin" "$source_dir/autopilot-cockpit-recovery-smoke.mjs" --dry-run)"
fi
SMOKE="$smoke" "$node_bin" -e 'const b=JSON.parse(process.env.SMOKE);if(b?.mode!=="dry-run"||b?.provider_invoked!==false||b?.run_status!=="completed"||b?.reservation_status!=="settled"||b?.approved_revisions!==1||b?.reservations!==1||b?.supervisor_tasks!==1||b?.worker_results!==1)process.exit(1)'
printf '%s\n' '{"ok":true,"boundary":true,"provider_invoked":false}'
