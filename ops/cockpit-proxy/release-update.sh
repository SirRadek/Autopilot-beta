#!/bin/bash
# Second-and-later Cockpit static-release update operator.
#
# The initial production cutover (ops/cockpit-proxy/live-cutover.sh) installs the
# firewall, unmasks/enables/starts Caddy, and flips CONTROL_PLANE_SECURE_COOKIES.
# It is deliberately initial-only: it refuses unless Caddy is masked/inactive and
# the firewall is absent. This operator handles the follow-on case where those
# artifacts are already live and only the immutable static release under
# /srv/autopilot-cockpit/current must advance to a newly staged candidate.
#
# Caddy serves `root * /srv/autopilot-cockpit/current`; because that root is a
# symlink resolved by the kernel per request, the entire production mutation is a
# single atomic replacement of `current`. No Caddy reload, no config change, no
# firewall change, no Control Plane restart, and no environment change occur. The
# secure-cookie contract, provider/model/reasoning boundary, and managed state
# content are preserved untouched. Preflight does write one additive artifact: a
# fresh backup archive under ~/.local/state/autopilot/backups is captured as a
# recovery point (managed state itself is not modified). Every mutating step is
# journaled so an interruption is reconciled by --recover, and a failed or
# timed-out acceptance rolls the symlink back to the previously live release.
#
# Production execution is accepted only from the fixed, root-owned trusted path
# /usr/local/libexec/autopilot-cockpit-release-update, published once by the
# image-provisioning root channel via ops/cockpit-proxy/install-release-update.sh.
# `bash ops/cockpit-proxy/release-update.sh` is intentionally not a supported
# production invocation; the worker refuses any other $0 when running as root.
set -Eeuo pipefail

test_mode="${AUTOPILOT_RELEASE_UPDATE_TEST_MODE:-0}"
case "$test_mode" in 0|1) ;; *) exit 1 ;; esac
expected_uid=0
expected_gid=0
if [ "$test_mode" = 1 ]; then expected_uid="$(id -u)"; expected_gid="$(id -g)"; fi

# Production accepts execution only from the fixed, root-owned trusted worker path;
# any other $0 (e.g. a checkout copy run as root) is refused. A test build may point
# the same enforcement at a root-relative installed copy via
# AUTOPILOT_RELEASE_UPDATE_TEST_TRUSTED_PATH so the boundary is genuinely exercised
# (owner/mode/symlink/$0 checks all run) without requiring EUID 0 or a host mutation.
trusted_worker_path="/usr/local/libexec/autopilot-cockpit-release-update"
test_trusted_path=""
if [ "$test_mode" = 1 ]; then test_trusted_path="${AUTOPILOT_RELEASE_UPDATE_TEST_TRUSTED_PATH:-}"; fi
[ -z "$test_trusted_path" ] || trusted_worker_path="$test_trusted_path"

assert_trusted_invocation() {
	[ "$(readlink -f -- "$0")" = "$trusted_worker_path" ] || { printf '%s\n' "refusing mutable release-update worker" >&2; exit 1; }
	[ ! -L "$trusted_worker_path" ] && [ "$(stat -c %u:%g:%a -- "$trusted_worker_path")" = "$expected_uid:$expected_gid:755" ] || { printf '%s\n' "refusing mutable release-update worker" >&2; exit 1; }
}

if [ "$EUID" -eq 0 ]; then
	PATH=/usr/sbin:/usr/bin:/sbin:/bin
	export PATH
	assert_trusted_invocation
fi
if [ "$test_mode" = 0 ]; then
	PATH=/usr/sbin:/usr/bin:/sbin:/bin
	export PATH
	[ "$EUID" -eq 0 ] || { printf '%s\n' "release update requires EUID 0" >&2; exit 1; }
elif [ -n "$test_trusted_path" ]; then
	assert_trusted_invocation
fi

root="${AUTOPILOT_RELEASE_UPDATE_TEST_ROOT:-}"
if [ "$test_mode" = 0 ]; then
	[ -z "$root" ] || exit 1
else
	[ -n "$root" ] && [ -d "$root" ] && [ ! -L "$root" ] || exit 1
	root="$(realpath -e -- "$root")"
	case "$root" in /tmp/*) ;; *) exit 1 ;; esac
fi
checkout_uid=""
checkout_gid=""

under_root() {
	local value="$1"
	if [ -n "$root" ]; then printf '%s%s\n' "$root" "$value"; else printf '%s\n' "$value"; fi
}

short_command() { timeout --signal=TERM --kill-after=5s 30s "$@"; }
long_command() { timeout --signal=TERM --kill-after=10s 180s "$@"; }

proc_starttime() {
	local pid="$1" rest
	[ -r "/proc/$pid/stat" ] || return 1
	rest="$(sed 's/^.*) //' "/proc/$pid/stat")" || return 1
	printf '%s\n' "$rest" | awk '{print $20}'
}

checkout_identity_valid() {
	[ -n "${checkout_handle:-}" ] && [ -n "${checkout_identity:-}" ] || return 1
	[ "$(stat -Lc %d:%i:%u:%g:%a -- "$checkout_handle")" = "$checkout_identity" ] || return 1
	[ "$(stat -Lc %d:%i:%u:%g:%a -- "$checkout")" = "$checkout_identity" ]
}

project_git() {
	local setpriv_bin=/usr/bin/setpriv env_bin=/usr/bin/env git_bin=/usr/bin/git project_path=/usr/bin:/bin status
	if [ "$test_mode" = 1 ]; then setpriv_bin="$(command -v setpriv)"; env_bin="$(command -v env)"; git_bin="$(command -v git)"; project_path="$(dirname "$git_bin"):/usr/bin:/bin"; fi
	checkout_identity_valid || return 1
	if [ "$test_mode" = 1 ]; then
		if short_command "$setpriv_bin" --reuid "$checkout_uid" --regid "$checkout_gid" --clear-groups -- "$env_bin" -i HOME=/home/radek USER=radek LOGNAME=radek SHELL=/bin/bash PATH="$project_path" AUTOPILOT_PRIVDROP_ACTIVE=1 STUB_LOG="${STUB_LOG:-/dev/null}" "$git_bin" -C "$checkout_handle" "$@"; then status=0; else status=$?; fi
	else
		if short_command "$setpriv_bin" --reuid "$checkout_uid" --regid "$checkout_gid" --clear-groups -- "$env_bin" -i HOME=/home/radek USER=radek LOGNAME=radek SHELL=/bin/bash PATH="$project_path" /usr/bin/git -C "$checkout_handle" "$@"; then status=0; else status=$?; fi
	fi
	checkout_identity_valid || return 1
	return "$status"
}

project_long() {
	local setpriv_bin=/usr/bin/setpriv env_bin=/usr/bin/env npm_bin=/usr/bin/npm project_path=/usr/bin:/bin status
	if [ "$test_mode" = 1 ]; then
		setpriv_bin="$(command -v setpriv)"; env_bin="$(command -v env)"; npm_bin="$(command -v npm)"
		project_path="$(dirname "$npm_bin"):/usr/bin:/bin"
	fi
	checkout_identity_valid || return 1
	if [ "$test_mode" = 1 ]; then
		if long_command "$setpriv_bin" --reuid "$checkout_uid" --regid "$checkout_gid" --clear-groups -- "$env_bin" -C "$checkout_handle" -i HOME=/home/radek USER=radek LOGNAME=radek SHELL=/bin/bash PATH="$project_path" AUTOPILOT_PRIVDROP_ACTIVE=1 STUB_LOG="${STUB_LOG:-/dev/null}" AUTOPILOT_RELEASE_UPDATE_TEST_ROOT="$root" "$npm_bin" --silent "$@"; then status=0; else status=$?; fi
	else
		if long_command "$setpriv_bin" --reuid "$checkout_uid" --regid "$checkout_gid" --clear-groups -- "$env_bin" -C "$checkout_handle" -i HOME=/home/radek USER=radek LOGNAME=radek SHELL=/bin/bash PATH="$project_path" /usr/bin/npm --silent "$@"; then status=0; else status=$?; fi
	fi
	checkout_identity_valid || return 1
	return "$status"
}

inspect_command() {
	inspection_output=""
	if inspection_output="$("$@")"; then inspection_rc=0; else inspection_rc=$?; fi
}

require_active() {
	inspect_command short_command systemctl is-active "$1"
	[ "$inspection_rc" -eq 0 ] && [ "$inspection_output" = active ]
}

safe_regular() {
	[ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u:%g -- "$1")" = "$expected_uid:$expected_gid" ]
}

safe_owned_directory() {
	[ -d "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u:%g:%a "$1")" = "$expected_uid:$expected_gid:755" ]
}

runtime="$(under_root /run/autopilot-cockpit-release-update)"
transaction_root="$(under_root /var/lib/autopilot-cockpit/release-update-transactions)"
transaction_dir="$transaction_root/active"
ledger="$transaction_dir/transaction.ledger"
runtime_ledger="$runtime/transaction.ledger"
ack_file="$runtime/host.accepted"
transaction_lock_fd=""
lock_held=0

open_transaction_lock() {
	[ -d "$transaction_root" ] && [ ! -L "$transaction_root" ] || return 1
	[ "$(stat -c %u:%g:%a "$transaction_root")" = "$expected_uid:$expected_gid:700" ] || return 1
	exec {transaction_lock_fd}>"$transaction_root/transaction.lock"
	if [ "$test_mode" = 0 ]; then chown 0:0 "$transaction_root/transaction.lock"; fi
	chmod 0600 "$transaction_root/transaction.lock"
}

lock_transaction() { [ "$lock_held" = 0 ] || return 0; flock -w 30 "$transaction_lock_fd"; lock_held=1; }
unlock_transaction() { [ "$lock_held" = 1 ] || return 0; flock -u "$transaction_lock_fd"; lock_held=0; }

validate_ledger_schema() {
	local candidate="$1"
	[ -f "$candidate" ] && [ ! -L "$candidate" ] || return 1
	[ -n "$(tail -c 1 -- "$candidate")" ] && return 1 || :
	LC_ALL=C awk -F= '
	BEGIN {
		n=split("version state ack_id sha checkout release_root owner_pid owner_starttime boot_id deadline_epoch prior_current_target current_attempted current_switched registered_temp_path registered_temp_kind registered_temp_identity", keys, " ");
		for (i=1;i<=n;i++) allowed[keys[i]]=1
	}
	{
		if ($0 !~ /^[A-Za-z0-9_]+=[A-Za-z0-9_.\/:@-]*$/) exit 10
		key=$1; if (!(key in allowed) || ++seen[key] != 1) exit 11
	}
	END {
		if (NR != n) exit 12
		for (key in allowed) if (seen[key] != 1) exit 13
	}' "$candidate" || return 1
	[ "$(awk -F= '$1=="version" {print $2}' "$candidate")" = autopilot-cockpit-release-update-v1 ]
}

ledger_value() {
	local key="$1"
	validate_ledger_schema "$ledger" || return 1
	awk -F= -v key="$key" '$1 == key { if (++n > 1) exit 2; print substr($0, length(key) + 2) } END { if (n != 1) exit 2 }' "$ledger"
}

archive_terminal_transaction() {
	[ -e "$transaction_dir" ] || [ -L "$transaction_dir" ] || return 0
	[ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(stat -c %u:%g:%a "$transaction_dir")" = "$expected_uid:$expected_gid:700" ] || return 1
	safe_regular "$ledger" && [ "$(stat -c %a "$ledger")" = 600 ] || return 1
	local archived_state archived_sha archived_ack history_entry
	archived_state="$(ledger_value state)"
	case "$archived_state" in completed|rolled-back) ;; *) return 1 ;; esac
	archived_sha="$(ledger_value sha)"; archived_ack="$(ledger_value ack_id)"
	[[ "$archived_sha" =~ ^[a-f0-9]{40}$ && "$archived_ack" =~ ^[a-f0-9]{64}$ ]] || return 1
	install -d -m 0700 "$transaction_root/history"
	history_entry="$transaction_root/history/$archived_sha-$archived_ack"
	[ ! -e "$history_entry" ] && [ ! -L "$history_entry" ] || return 1
	mv -T "$transaction_dir" "$history_entry"
	find -P "$history_entry" -type f -exec chmod 0400 {} +
	find -P "$history_entry" -type d -exec chmod 0500 {} +
}

# --------------------------------------------------------------------------
# --accept ACK_ID: the host operator confirms the newly served release.
# --------------------------------------------------------------------------
if [ "${1:-}" = "--accept" ]; then
	[ "$#" -eq 2 ] || exit 1
	ack_id="$2"
	[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || { printf '%s\n' "invalid acknowledgement ID" >&2; exit 1; }
	open_transaction_lock
	lock_transaction
	[ -d "$runtime" ] && [ ! -L "$runtime" ] || exit 1
	[ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ] || exit 1
	safe_regular "$ledger" && [ "$(stat -c %a -- "$ledger")" = 600 ] || exit 1
	[ "$(ledger_value state)" = waiting ] || exit 1
	[ "$(ledger_value ack_id)" = "$ack_id" ] || exit 1
	ack_owner_pid="$(ledger_value owner_pid)"; ack_owner_starttime="$(ledger_value owner_starttime)"
	ack_boot_id="$(ledger_value boot_id)"; ack_deadline="$(ledger_value deadline_epoch)"
	[[ "$ack_owner_pid" =~ ^[0-9]+$ && "$ack_owner_starttime" =~ ^[0-9]+$ && "$ack_deadline" =~ ^[0-9]+$ ]] || exit 1
	[ "$ack_boot_id" = "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)" ] || exit 1
	kill -0 "$ack_owner_pid" 2>/dev/null
	[ "$(proc_starttime "$ack_owner_pid")" = "$ack_owner_starttime" ]
	[ "$(date +%s)" -le "$ack_deadline" ]
	[ ! -e "$ack_file" ] && [ ! -L "$ack_file" ] || exit 1
	umask 077
	tmp_ack="$(mktemp -- "$runtime/.host.accepted.XXXXXXXXXX")"
	trap 'rm -f -- "${tmp_ack:-}"' EXIT
	printf '%s\n' "$ack_id" > "$tmp_ack"
	chmod 0600 "$tmp_ack"
	if [ "$test_mode" = 0 ]; then chown 0:0 "$tmp_ack"; fi
	mv -T -- "$tmp_ack" "$ack_file"
	tmp_ack=""
	trap - EXIT
	printf '%s\n' "RELEASE_UPDATE_HOST_ACCEPTANCE_ACKNOWLEDGED"
	unlock_transaction
	exit 0
fi

recover_mode=0
if [ "${1:-}" = "--recover" ]; then
	[ "$#" -eq 1 ] || exit 1
	recover_mode=1
elif [ "$#" -ne 3 ]; then
	printf '%s\n' "usage: release-update.sh CHECKOUT RELEASE_ROOT SHA | --accept ACK_ID | --recover" >&2
	exit 1
fi

if [ "$recover_mode" = 1 ]; then
	open_transaction_lock
	lock_transaction
	safe_regular "$ledger" && [ "$(stat -c %a -- "$ledger")" = 600 ] || { printf '%s\n' RECOVERY_NOT_NEEDED; exit 0; }
	case "$(ledger_value state)" in completed|rolled-back) printf '%s\n' RECOVERY_NOT_NEEDED; exit 0 ;; esac
	release_root="$(ledger_value release_root)"
	accepted_sha="$(ledger_value sha)"
	checkout="$(ledger_value checkout)"
else
	checkout="$(realpath -e -- "$1")"
	release_root="$(realpath -e -- "$2")"
	accepted_sha="$3"
fi
[[ "$checkout" =~ ^/[A-Za-z0-9._/-]+$ && "$release_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || exit 1
[[ "$accepted_sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
if [ "$recover_mode" = 0 ]; then
	[ ! -L "$1" ] && [ ! -L "$2" ] || exit 1
	[ "$1" = "$checkout" ] && [ "$2" = "$release_root" ] || exit 1
else
	[ "$(realpath -e -- "$release_root")" = "$release_root" ] || exit 1
fi
if [ "$test_mode" = 0 ]; then [ "$release_root" = /srv/autopilot-cockpit ] || exit 1; fi
[ "$(stat -c %u:%g:%a -- "$release_root")" = "$expected_uid:$expected_gid:755" ]

environment="$(under_root /home/radek/.config/autopilot/control-plane.env)"
caddy_config="$(under_root /etc/caddy/Caddyfile)"
caddy_dropin="$(under_root /etc/systemd/system/caddy.service.d/autopilot.conf)"
package_caddy_unit="$(under_root /usr/lib/systemd/system/caddy.service)"
firewall_unit="$(under_root /etc/systemd/system/autopilot-cockpit-firewall.service)"
nft_config="$(under_root /etc/nftables.d/autopilot-cockpit.nft)"
firewall_helper="$(under_root /usr/local/libexec/autopilot-cockpit-firewall)"
firewall_identity="$(under_root /var/lib/autopilot-cockpit/firewall.identity)"
release="$release_root/releases/$accepted_sha"
manifest="$release_root/manifests/$accepted_sha.sha256"
current="$release_root/current"

if [ "$recover_mode" = 0 ]; then
	exec {release_lock_fd}<"$release_root"
	flock -w 30 "$release_lock_fd"
	if [ -e "$transaction_dir" ] || [ -L "$transaction_dir" ]; then
		[ -d "$transaction_root" ] && [ ! -L "$transaction_root" ] && [ "$(stat -c %u:%g:%a "$transaction_root")" = "$expected_uid:$expected_gid:700" ] || exit 1
		open_transaction_lock
		lock_transaction
		archive_terminal_transaction
		unlock_transaction
	fi
	checkout_uid="$(stat -c %u -- "$checkout")"
	checkout_gid="$(stat -c %g -- "$checkout")"
	if [ "$test_mode" = 0 ]; then
		[ "$checkout_uid" = "$(id -u radek)" ] && [ "$checkout_gid" = "$(id -g radek)" ] || exit 1
	fi
	exec {checkout_fd}<"$checkout"
	checkout_handle="/proc/self/fd/$checkout_fd"
	checkout_identity="$(stat -Lc %d:%i:%u:%g:%a -- "$checkout")"
	checkout_identity_valid
fi
if [ "$test_mode" = 1 ]; then node_bin="${AUTOPILOT_NODE_BIN:-/usr/bin/node}"; else node_bin=/usr/bin/node; fi

update_started=0
rollback_started=0
rollback_failed=0
current_attempted=0
current_switched=0
prior_current_target=""
runtime_created=0
transaction_created=0
ack_id=""
registered_temp_path=""
registered_temp_kind=""
registered_temp_identity=""

write_ledger() {
	local state="$1" tmp acquired=0
	if [ "$lock_held" = 0 ]; then lock_transaction; acquired=1; fi
	tmp="$(mktemp -- "$transaction_dir/.ledger.XXXXXXXXXX")"
	printf 'version=autopilot-cockpit-release-update-v1\nstate=%s\nack_id=%s\nsha=%s\ncheckout=%s\nrelease_root=%s\nowner_pid=%s\nowner_starttime=%s\nboot_id=%s\ndeadline_epoch=%s\nprior_current_target=%s\ncurrent_attempted=%s\ncurrent_switched=%s\nregistered_temp_path=%s\nregistered_temp_kind=%s\nregistered_temp_identity=%s\n' \
		"$state" "$ack_id" "$accepted_sha" "$checkout" "$release_root" "${transaction_owner_pid:-$$}" "${transaction_owner_starttime:-0}" "${transaction_boot_id:-unknown}" "${transaction_deadline_epoch:-0}" "$prior_current_target" "$current_attempted" "$current_switched" "$registered_temp_path" "$registered_temp_kind" "$registered_temp_identity" > "$tmp"
	validate_ledger_schema "$tmp"
	chmod 0600 "$tmp"
	if [ "$test_mode" = 0 ]; then chown 0:0 "$tmp"; fi
	mv -T -- "$tmp" "$ledger"
	if [ -d "$runtime" ] && [ ! -L "$runtime" ]; then
		tmp="$(mktemp -- "$runtime/.ledger.XXXXXXXXXX")"
		cp -- "$ledger" "$tmp" && chmod 0600 "$tmp" && { [ "$test_mode" = 1 ] || chown 0:0 "$tmp"; } && mv -T -- "$tmp" "$runtime_ledger"
	fi
	if [ "$acquired" = 1 ]; then unlock_transaction; fi
}

temp_identity() {
	if [ "$1" = symlink ]; then printf '%s' "$(readlink -- "$2")" | sha256sum | awk '{print $1}'
	else return 1; fi
}

register_temp() {
	local ledger_state="${4:-mutating}"
	[ -z "$registered_temp_path" ] || return 1
	registered_temp_path="$1"; registered_temp_kind="$2"; registered_temp_identity="$3"
	[ ! -e "$registered_temp_path" ] && [ ! -L "$registered_temp_path" ] || return 1
	write_ledger "$ledger_state"
}

clear_registered_temp() {
	local ledger_state="${1:-mutating}"
	if [ -n "$registered_temp_path" ] && { [ -e "$registered_temp_path" ] || [ -L "$registered_temp_path" ]; }; then
		[ "$(temp_identity "$registered_temp_kind" "$registered_temp_path")" = "$registered_temp_identity" ] || return 1
		rm -f -- "$registered_temp_path" || return 1
	fi
	registered_temp_path=""; registered_temp_kind=""; registered_temp_identity=""
	write_ledger "$ledger_state"
}

fail_after() {
	if [ "$test_mode" = 1 ] && [ "${AUTOPILOT_RELEASE_UPDATE_TEST_FAIL_AFTER:-}" = "$1" ]; then
		printf 'injected failure after %s\n' "$1" >&2
		return 75
	fi
}

test_kill_boundary() {
	local variable="$1" phase="$2"
	[ "$test_mode" = 1 ] || return 0
	[ "${!variable:-}" = "$phase" ] || return 0
	kill -KILL $$
}

validate_secure_cookie_true() {
	ENV_INPUT="$1" "$node_bin" -e '
const fs=require("fs"),{TextDecoder}=require("util"),b=fs.readFileSync(process.env.ENV_INPUT);
let s;try{s=new TextDecoder("utf-8",{fatal:true}).decode(b)}catch{process.exit(1)}
if(s.includes("\0"))process.exit(1);
if(/\\\r?\n/.test(s))process.exit(1);
const lines=s.split("\n"),mentions=lines.filter(v=>v.includes("CONTROL_PLANE_SECURE_COOKIES"));
if(mentions.length!==1||mentions[0]!=="CONTROL_PLANE_SECURE_COOKIES=true")process.exit(1);'
}

validate_ready_file() {
	READY_JSON_PATH="$1" "$node_bin" -e '
const b=JSON.parse(require("fs").readFileSync(process.env.READY_JSON_PATH,"utf8"));
if(b?.ready!==true)process.exit(1);
for(const n of ["configuration","managed_state","project_registry","supervisor","token_gateway"])
 if(b?.components?.[n]?.status!=="ready"||b.components[n].error_code!==null)process.exit(1);'
}

http_readiness_checks() {
	local work health_status ready_status checks_parent
	checks_parent=/tmp
	if [ -d "$runtime" ] && [ ! -L "$runtime" ]; then checks_parent="$runtime"; fi
	work="$(mktemp -d -- "$checks_parent/.autopilot-release-update-checks.XXXXXXXXXX")" || return 1
	case "$work" in "$checks_parent"/.autopilot-release-update-checks.*) ;; *) return 1 ;; esac
	[ -d "$work" ] && [ ! -L "$work" ] && [ "$(stat -c %u:%g:%a -- "$work")" = "$expected_uid:$expected_gid:700" ] || return 1
	if ! health_status="$(short_command curl --disable --noproxy '*' --silent --show-error --connect-timeout 1 --max-time 2 --output "$work/health.json" --write-out '%{http_code}' http://127.0.0.1:8787/health)" || [ "$health_status" != 200 ]; then rm -rf -- "$work"; return 1; fi
	if ! HEALTH_JSON_PATH="$work/health.json" "$node_bin" -e 'const b=JSON.parse(require("fs").readFileSync(process.env.HEALTH_JSON_PATH));if(b?.ok!==true)process.exit(1)'; then rm -rf -- "$work"; return 1; fi
	if ! ready_status="$(short_command curl --disable --noproxy '*' --silent --show-error --connect-timeout 1 --max-time 2 --output "$work/ready.json" --write-out '%{http_code}' http://127.0.0.1:8787/ready)" || [ "$ready_status" != 200 ] || ! validate_ready_file "$work/ready.json"; then rm -rf -- "$work"; return 1; fi
	rm -rf -- "$work"
}

loopback_listener_check() {
	local listener
	listener="$(timeout --signal=TERM --kill-after=2s 5s ss -H -ltn "sport = :8787")" || return 1
	[ "$(printf '%s\n' "$listener" | sed '/^$/d' | wc -l)" -eq 1 ] || return 1
	[[ "$listener" == *"127.0.0.1:8787"* ]] || return 1
	[[ "$listener" != *"0.0.0.0:8787"* && "$listener" != *"[::]:8787"* ]] || return 1
}

loopback_checks() { http_readiness_checks && loopback_listener_check; }

wait_for_loopback_checks() {
	local attempt=0 deadline=$((SECONDS + 45)) delay=1
	if [ "$test_mode" = 1 ]; then delay=0.01; fi
	while (( attempt < 15 && SECONDS < deadline )); do
		attempt=$((attempt + 1))
		if http_readiness_checks; then
			if loopback_listener_check; then return 0; fi
			return 1
		fi
		(( attempt < 15 && SECONDS < deadline )) || break
		sleep "$delay"
	done
	return 1
}

nft_presence() {
	local json
	json="$(short_command nft -j list tables)" || return 2
	NFT_JSON="$json" "$node_bin" -e '
const d=JSON.parse(process.env.NFT_JSON);const m=(d.nftables??[]).filter(x=>x.table?.family==="inet"&&x.table?.name==="autopilot_cockpit");
if(m.length>1)process.exit(2);process.stdout.write(m.length?"present":"absent");' || return 2
}

nft_identity_valid_installed() {
	local installed_ack json
	safe_regular "$firewall_identity" && [ "$(stat -c %a "$firewall_identity")" = 600 ] || return 1
	installed_ack="$(cat "$firewall_identity")"
	[[ "$installed_ack" =~ ^[a-f0-9]{64}$ ]] || return 1
	json="$(short_command nft -j list table inet autopilot_cockpit)" || return 2
	NFT_JSON="$json" NFT_NONCE="$installed_ack" "$node_bin" -e '
const d=JSON.parse(process.env.NFT_JSON),e=d.nftables??[],c=`autopilot-cockpit:${process.env.NFT_NONCE}`;
const t=e.filter(x=>x.table?.family==="inet"&&x.table?.name==="autopilot_cockpit");
const ch=e.filter(x=>x.chain?.family==="inet"&&x.chain?.table==="autopilot_cockpit"&&x.chain?.name==="input");
const r=e.filter(x=>x.rule?.family==="inet"&&x.rule?.table==="autopilot_cockpit"&&x.rule?.chain==="input");
if(t.length!==1||ch.length!==1||r.length!==1||t[0].table.comment!==c||ch[0].chain.comment!==c||r[0].rule.comment!==c)process.exit(1);
const chain=ch[0].chain;if(chain.type!=="filter"||chain.hook!=="input"||chain.prio!==-10||chain.policy!=="accept")process.exit(1);
const x=[{match:{op:"==",left:{payload:{protocol:"tcp",field:"dport"}},right:{set:[80,443]}}},{match:{op:"!=",left:{payload:{protocol:"ip",field:"saddr"}},right:"192.168.122.1"}},{drop:null}];
if(JSON.stringify(r[0].rule.expr)!==JSON.stringify(x))process.exit(1);'
}

caddy_serving_ports() {
	local port listener
	for port in 80 443; do
		listener="$(short_command ss -H -ltn "sport = :$port")" || return 1
		[ "$(printf '%s\n' "$listener" | sed '/^$/d' | wc -l)" -eq 1 ] || return 1
		[[ "$listener" == *"192.168.122.99:$port"* ]] || return 1
		[[ "$listener" != *"0.0.0.0:$port"* && "$listener" != *"[::]:$port"* ]] || return 1
	done
}

acceptance_ports_absent() {
	local port output
	for port in 8443 8877; do
		output="$(short_command ss -H -ltn "sport = :$port")" || return 1
		[ -z "$output" ] || return 1
	done
}

release_tree_valid() {
	[ -d "$release" ] && [ ! -L "$release" ] && safe_regular "$manifest" || return 1
	[ "$(stat -c %a -- "$manifest")" = 444 ] || return 1
	[ -z "$(find -P "$release" -mindepth 1 ! -type d ! -type f -print -quit)" ] || return 1
	[ -z "$(find -P "$release" -type d \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0555 \) -print -quit)" ] || return 1
	[ -z "$(find -P "$release" -type f \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0444 \) -print -quit)" ] || return 1
	(cd "$release" && sha256sum --check --strict "$manifest" >/dev/null)
}

live_proxy_boundary_valid() {
	require_active caddy.service || return 1
	require_active autopilot-cockpit-firewall.service || return 1
	inspect_command nft_presence
	[ "$inspection_rc" -eq 0 ] && [ "$inspection_output" = present ] || return 1
	nft_identity_valid_installed || return 1
	caddy_serving_ports || return 1
	loopback_checks || return 1
}

recovery_checks() {
	local state_dir projects_dir backup_dir backup_json archive recovery_json
	state_dir="$(sed -n 's/^AUTOPILOT_STATE_DIR=//p' "$environment")"
	projects_dir="$(sed -n 's/^AUTOPILOT_PROJECTS_DIR=//p' "$environment")"
	[ -n "$state_dir" ] && [ -n "$projects_dir" ] || return 1
	if [ "$test_mode" = 1 ]; then state_dir="$(under_root "$state_dir")"; projects_dir="$(under_root "$projects_dir")"; fi
	backup_dir="$(under_root /home/radek/.local/state/autopilot/backups)"
	mkdir -p -- "$backup_dir"
	backup_json="$(project_long run ops:backup -- "$state_dir" "$backup_dir")"
	archive="$(BACKUP_JSON="$backup_json" "$node_bin" -e 'const b=JSON.parse(process.env.BACKUP_JSON);if(b?.validation?.valid!==true||typeof b.path!=="string")process.exit(1);process.stdout.write(b.path)')"
	[ -f "$archive" ] && [ ! -L "$archive" ] || return 1
	recovery_json="$(project_long run ops:recovery-drill -- "$archive")"
	RECOVERY_JSON="$recovery_json" "$node_bin" -e 'const b=JSON.parse(process.env.RECOVERY_JSON);if(b?.ok!==true||b?.validation?.ready!==true||b?.validation?.reconciled!==true||(b.validation.errors??[]).length)process.exit(1)'
}

state_boundary_checks() {
	local state_dir projects_dir smoke
	state_dir="$(sed -n 's/^AUTOPILOT_STATE_DIR=//p' "$environment")" || return 1
	projects_dir="$(sed -n 's/^AUTOPILOT_PROJECTS_DIR=//p' "$environment")" || return 1
	if [ "$test_mode" = 1 ]; then state_dir="$(under_root "$state_dir")"; projects_dir="$(under_root "$projects_dir")"; fi
	project_long run ops:boundary-check -- "$checkout" "$state_dir" "$projects_dir" >/dev/null || return 1
	smoke="$(project_long run smoke:cockpit-run -- --dry-run)" || return 1
	SMOKE_JSON="$smoke" "$node_bin" -e 'const b=JSON.parse(process.env.SMOKE_JSON);if(b?.provider_invoked!==false||b?.run_status!=="completed")process.exit(1)' || return 1
}

restore_previous_current() {
	# The previous release symlink is the entire rollback payload, so the prior
	# release directory must still exist as a real directory. If it is missing or a
	# symlink, restoration cannot honestly succeed: fail explicitly so the caller
	# reports ROLLBACK_FAILED rather than pointing current at a broken/absent target
	# and claiming ROLLBACK_OK.
	if [ "$current_attempted" != 1 ]; then return 0; fi
	[[ "$prior_current_target" =~ ^releases/[a-f0-9]{40}$ ]] || return 1
	[ -d "$release_root/$prior_current_target" ] && [ ! -L "$release_root/$prior_current_target" ] || return 1
	if [ -L "$current" ] && [ "$(readlink "$current")" = "$prior_current_target" ]; then return 0; fi
	if [ -L "$current" ] && [ "$(readlink "$current")" = "releases/$accepted_sha" ]; then
		local tmp_restore="$release_root/.restore-current-$ack_id"
		register_temp "$tmp_restore" symlink "$(printf '%s' "$prior_current_target" | sha256sum | awk '{print $1}')" rolling-back || return 1
		ln -s "$prior_current_target" "$tmp_restore"
		mv -T -- "$tmp_restore" "$current"
		clear_registered_temp rolling-back || return 1
		return 0
	fi
	return 1
}

rollback_verification() {
	wait_for_loopback_checks || return 1
	require_active caddy.service || return 1
	require_active autopilot-cockpit-firewall.service || return 1
	inspect_command nft_presence
	[ "$inspection_rc" -eq 0 ] && [ "$inspection_output" = present ] || return 1
	nft_identity_valid_installed || return 1
	caddy_serving_ports || return 1
	acceptance_ports_absent || return 1
	# The checkout privilege-drop handle only exists on the forward path; a
	# boot-time --recover reconciles live boundary evidence without it. Managed
	# state is never mutated by this operator, so no restore or drill is required.
	[ "$recover_mode" = 1 ] && return 0
	state_boundary_checks || return 1
}

rollback() {
	rollback_started=1
	# A rollback must finalize its journal even under repeated operator INT/TERM.
	# on_exit has already reset the EXIT/INT/TERM traps to default, which would let a
	# second Ctrl-C (or a stop signal) kill the process mid-write and leave the ledger
	# non-terminal. Ignore further INT/TERM here so ledger finalization always completes;
	# a stuck rollback can still be reconciled by a later --recover.
	trap '' INT TERM
	set +e
	write_ledger rolling-back || rollback_failed=1
	clear_registered_temp rolling-back || rollback_failed=1
	local live_state_safe=1
	if ! restore_previous_current; then rollback_failed=1; live_state_safe=0; fi
	if [ "$live_state_safe" = 1 ]; then
		rollback_verification || rollback_failed=1
	fi
	if [ "$rollback_failed" = 0 ]; then write_ledger rolled-back || rollback_failed=1; else write_ledger rollback-failed || rollback_failed=1; fi
	if [ "$rollback_failed" = 0 ]; then printf '%s\n' ROLLBACK_OK; else printf '%s\n' ROLLBACK_FAILED; fi
	set -e
}

on_exit() {
	local status=$?
	trap - EXIT INT TERM
	if (( status != 0 && update_started == 1 && rollback_started == 0 )); then rollback; fi
	if (( status != 0 && update_started == 0 && runtime_created == 1 )); then
		[ -d "$runtime" ] && [ ! -L "$runtime" ] && [ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ] && rm -rf -- "$runtime"
	fi
	if (( status != 0 && update_started == 0 && transaction_created == 1 )); then
		[ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(stat -c %u:%g:%a -- "$transaction_dir")" = "$expected_uid:$expected_gid:700" ] && rm -rf -- "$transaction_dir"
	fi
	exit "$status"
}
on_int() { exit 130; }
on_term() { exit 143; }
trap on_exit EXIT
trap on_int INT
trap on_term TERM

# --------------------------------------------------------------------------
# --recover: reconcile an interrupted transaction back to the prior release.
# --------------------------------------------------------------------------
if [ "$recover_mode" = 1 ]; then
	[ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(stat -c %u:%g:%a "$transaction_dir")" = "$expected_uid:$expected_gid:700" ] || exit 1
	state="$(ledger_value state)"
	case "$state" in completed|rolled-back) printf '%s\n' RECOVERY_NOT_NEEDED; exit 0 ;; prepared|mutating|verifying|waiting|rolling-back|rollback-failed) ;; *) exit 1 ;; esac
	transaction_owner_pid="$(ledger_value owner_pid)"
	transaction_owner_starttime="$(ledger_value owner_starttime)"
	transaction_boot_id="$(ledger_value boot_id)"
	transaction_deadline_epoch="$(ledger_value deadline_epoch)"
	[[ "$transaction_owner_pid" =~ ^[0-9]+$ && "$transaction_owner_starttime" =~ ^[0-9]+$ && "$transaction_deadline_epoch" =~ ^[0-9]+$ ]] || exit 1
	current_boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)"
	if [ "$transaction_boot_id" = "$current_boot_id" ] && kill -0 "$transaction_owner_pid" 2>/dev/null && [ "$(proc_starttime "$transaction_owner_pid" 2>/dev/null || true)" = "$transaction_owner_starttime" ] && [ "$(date +%s)" -le "$transaction_deadline_epoch" ]; then
		printf '%s\n' RECOVERY_OWNER_ACTIVE
		exit 0
	fi
	exec {release_lock_fd}<"$release_root"
	flock -w 30 "$release_lock_fd"
	# The state/owner snapshot above was read before the release lock and may have
	# raced a concurrent owner or a competing recovery. A forward owner holds this
	# same lock for its whole life, so once we hold it no owner is running; re-read
	# the ledger under the lock and revalidate terminality, transaction identity, and
	# ownership before mutating anything.
	validate_ledger_schema "$ledger" || exit 1
	state="$(ledger_value state)"
	case "$state" in
		completed|rolled-back) printf '%s\n' RECOVERY_NOT_NEEDED; exit 0 ;;
		prepared|mutating|verifying|waiting|rolling-back|rollback-failed) ;;
		*) exit 1 ;;
	esac
	relocked_owner_pid="$(ledger_value owner_pid)"
	relocked_owner_starttime="$(ledger_value owner_starttime)"
	relocked_boot_id="$(ledger_value boot_id)"
	relocked_deadline_epoch="$(ledger_value deadline_epoch)"
	[[ "$relocked_owner_pid" =~ ^[0-9]+$ && "$relocked_owner_starttime" =~ ^[0-9]+$ && "$relocked_deadline_epoch" =~ ^[0-9]+$ ]] || exit 1
	# The active transaction identity must be stable across the lock; a changed
	# owner pid/starttime/boot means the transaction was replaced and this recovery
	# is stale (retry with a fresh snapshot rather than acting on the wrong one).
	[ "$relocked_owner_pid" = "$transaction_owner_pid" ] && [ "$relocked_owner_starttime" = "$transaction_owner_starttime" ] && [ "$relocked_boot_id" = "$transaction_boot_id" ] || exit 1
	transaction_deadline_epoch="$relocked_deadline_epoch"
	if [ "$relocked_boot_id" = "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)" ] && kill -0 "$relocked_owner_pid" 2>/dev/null && [ "$(proc_starttime "$relocked_owner_pid" 2>/dev/null || true)" = "$relocked_owner_starttime" ] && [ "$(date +%s)" -le "$relocked_deadline_epoch" ]; then
		printf '%s\n' RECOVERY_OWNER_ACTIVE
		exit 0
	fi
	ack_id="$(ledger_value ack_id)"
	[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
	prior_current_target="$(ledger_value prior_current_target)"
	[[ "$prior_current_target" =~ ^releases/[a-f0-9]{40}$ ]] || exit 1
	for flag in current_attempted current_switched; do
		value="$(ledger_value "$flag")"
		case "$value" in 0|1) printf -v "$flag" '%s' "$value" ;; *) exit 1 ;; esac
	done
	registered_temp_path="$(ledger_value registered_temp_path)"
	registered_temp_kind="$(ledger_value registered_temp_kind)"
	registered_temp_identity="$(ledger_value registered_temp_identity)"
	if [ -n "$registered_temp_path" ]; then
		case "$registered_temp_kind" in symlink) ;; *) exit 1 ;; esac
		[[ "$registered_temp_identity" =~ ^[a-f0-9]{64}$ ]] || exit 1
		case "$registered_temp_path" in
			"$release_root/.current-$ack_id"|"$release_root/.restore-current-$ack_id") ;;
			*) exit 1 ;;
		esac
	else
		[ -z "$registered_temp_kind" ] && [ -z "$registered_temp_identity" ] || exit 1
	fi
	update_started=1
	rollback
	[ "$rollback_failed" = 0 ]
	exit
fi

# --------------------------------------------------------------------------
# Forward path: complete every refusal check before touching live state.
# --------------------------------------------------------------------------
[ -x "$node_bin" ] || exit 1
case "$(short_command "$node_bin" --version)" in v24.*) ;; *) exit 1 ;; esac
[ "$(project_git rev-parse HEAD)" = "$accepted_sha" ]
# Capture the porcelain status and its exit status explicitly: a failed status probe
# must not read as a clean checkout via an empty command substitution.
if ! project_status="$(project_git status --porcelain)"; then printf '%s\n' "release update could not read checkout status" >&2; exit 1; fi
[ -z "$project_status" ] || exit 1
# The candidate must originate from the canonical origin, not an arbitrary local tree.
project_origin="$(project_git remote get-url origin)"
[[ "$project_origin" =~ ^[A-Za-z0-9+._:/@-]+$ ]]

# The accepted release must already be staged immutably and match the checkout build.
# release_tree_valid binds the staged manifest to the release-tree bytes it serves
# (sha256sum --check --strict over the full tree). Binding the SAME manifest to the
# checkout's cockpit/dist bytes proves the served release is byte-for-byte the reviewed
# build, not merely a tree with matching entry names and a self-consistent manifest. The
# manifest is a deterministic relative sha256 listing ("<hash>  ./path" over sorted files),
# so the comparison is identical for production and tests.
release_tree_valid
cmp -s "$manifest" <(cd "$checkout/cockpit/dist" && find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)

# The Control Plane must already be on the secure-cookie contract (initial cutover done).
[ -f "$environment" ] && [ ! -L "$environment" ] && [ "$(stat -c %a -- "$environment")" = 600 ] || exit 1
if [ "$test_mode" = 0 ]; then [ "$(stat -c %u -- "$environment")" = "$(id -u radek)" ] && [ "$(stat -c %g -- "$environment")" = "$(id -g radek)" ] || exit 1; fi
validate_secure_cookie_true "$environment"

# Core operational liveness.
loopback_checks
require_active autopilot-control-plane.service
require_active autopilot-control-plane-health.timer
require_active autopilot-state-maintenance.timer

# Caddy must already be installed, enabled, and active (opposite of initial cutover).
short_command dpkg -s caddy >/dev/null
inspect_command short_command systemctl is-enabled caddy.service
[ "$inspection_rc" -eq 0 ] && [ "$inspection_output" = enabled ] || exit 1
require_active caddy.service
inspect_command short_command dpkg -V caddy
if [ "$inspection_rc" -ne 0 ] || [ -n "$inspection_output" ]; then exit 1; fi

# The live proxy configuration must equal the accepted release's reviewed config;
# a static release update never rewrites the proxy. Any drift needs a config cutover.
[ -f "$caddy_config" ] && [ ! -L "$caddy_config" ] && [ "$(stat -c %u:%g:%a "$caddy_config")" = "$expected_uid:$expected_gid:644" ] || exit 1
cmp -s <(project_git show "$accepted_sha:ops/cockpit-proxy/Caddyfile") "$caddy_config"
[ -f "$caddy_dropin" ] && [ ! -L "$caddy_dropin" ] && [ "$(stat -c %u:%g:%a "$caddy_dropin")" = "$expected_uid:$expected_gid:644" ] || exit 1
cmp -s <(project_git show "$accepted_sha:ops/cockpit-proxy/caddy-autopilot.conf") "$caddy_dropin"
[ -f "$firewall_unit" ] && [ ! -L "$firewall_unit" ] && [ "$(stat -c %u:%g:%a "$firewall_unit")" = "$expected_uid:$expected_gid:644" ] || exit 1
cmp -s <(project_git show "$accepted_sha:ops/cockpit-proxy/autopilot-cockpit-firewall.service") "$firewall_unit"
[ -f "$nft_config" ] && [ ! -L "$nft_config" ] && [ "$(stat -c %u:%g:%a "$nft_config")" = "$expected_uid:$expected_gid:644" ] || exit 1
cmp -s <(project_git show "$accepted_sha:ops/cockpit-proxy/autopilot-cockpit.nft") "$nft_config"
[ -f "$firewall_helper" ] && [ ! -L "$firewall_helper" ] && [ "$(stat -c %u:%g:%a "$firewall_helper")" = "$expected_uid:$expected_gid:755" ] || exit 1
cmp -s <(project_git show "$accepted_sha:ops/cockpit-proxy/autopilot-cockpit-firewall.sh") "$firewall_helper"
[ -f "$package_caddy_unit" ] && [ ! -L "$package_caddy_unit" ] && [ "$(stat -c %u:%g:%a "$package_caddy_unit")" = "$expected_uid:$expected_gid:644" ] || exit 1

# Firewall must be active with the exact owned nft table; acceptance ports must be free.
require_active autopilot-cockpit-firewall.service
inspect_command nft_presence
[ "$inspection_rc" -eq 0 ] && [ "$inspection_output" = present ] || exit 1
nft_identity_valid_installed
caddy_serving_ports
acceptance_ports_absent

# There must be a live current release to advance from and roll back to.
[ -L "$current" ] || exit 1
prior_current_target="$(readlink -- "$current")"
[[ "$prior_current_target" =~ ^releases/[a-f0-9]{40}$ ]] || exit 1
[ -d "$release_root/$prior_current_target" ] && [ ! -L "$release_root/$prior_current_target" ] || exit 1

if [ "$prior_current_target" = "releases/$accepted_sha" ]; then
	printf '%s\n' RELEASE_UPDATE_ALREADY_CURRENT
	exit 0
fi

# --------------------------------------------------------------------------
# Transaction: the only production mutation is the atomic current swap.
# --------------------------------------------------------------------------
install -d -m 0700 "$transaction_root"
[ "$(stat -c %u:%g:%a -- "$transaction_root")" = "$expected_uid:$expected_gid:700" ]
open_transaction_lock
lock_transaction
mkdir -m 0700 -- "$transaction_dir"
transaction_created=1
if [ -e "$runtime" ] || [ -L "$runtime" ]; then
	[ -d "$runtime" ] && [ ! -L "$runtime" ] && [ "$(stat -c %u:%g:%a "$runtime")" = "$expected_uid:$expected_gid:700" ] || exit 1
	for old_runtime_file in "$runtime_ledger" "$ack_file"; do
		if [ -e "$old_runtime_file" ] || [ -L "$old_runtime_file" ]; then safe_regular "$old_runtime_file" && [ "$(stat -c %a "$old_runtime_file")" = 600 ] || exit 1; rm -f "$old_runtime_file"; fi
	done
	[ -z "$(find -P "$runtime" -mindepth 1 -maxdepth 1 -print -quit)" ] || exit 1
else
	mkdir -m 0700 -- "$runtime"
fi
[ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ]
runtime_created=1

ack_id="${AUTOPILOT_RELEASE_UPDATE_TEST_ACK_ID:-}"
if [ "$test_mode" = 0 ] || [ -z "$ack_id" ]; then ack_id="$(openssl rand -hex 32)"; fi
[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
transaction_owner_pid="$$"
transaction_owner_starttime="$(proc_starttime "$$")"
[[ "$transaction_owner_starttime" =~ ^[0-9]+$ ]] || exit 1
transaction_boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)"
transaction_deadline_epoch="$(( $(date +%s) + 600 ))"
write_ledger prepared
unlock_transaction

# Capture a fresh recovery point. This writes a new backup archive under the backups
# directory and runs a recovery drill against it; managed state content itself is not
# modified, but the backup archive is a real additive write (honest evidence capture).
recovery_checks
short_command caddy validate --config "$caddy_config" --adapter caddyfile >/dev/null
update_started=1

tmp_current="$release_root/.current-$ack_id"
register_temp "$tmp_current" symlink "$(printf '%s' "releases/$accepted_sha" | sha256sum | awk '{print $1}')"
ln -s "releases/$accepted_sha" "$tmp_current"
current_attempted=1; write_ledger mutating
# Compare-and-swap: current must still point to the previous release.
[ -L "$current" ] && [ "$(readlink "$current")" = "$prior_current_target" ] || exit 1
mv -T -- "$tmp_current" "$current"
clear_registered_temp
test_kill_boundary AUTOPILOT_RELEASE_UPDATE_TEST_KILL_AFTER current-mv
current_switched=1; write_ledger verifying
fail_after current

# Verify the live boundary still holds with the new release served.
live_proxy_boundary_valid
acceptance_ports_absent
[ -L "$current" ] && [ "$(readlink "$current")" = "releases/$accepted_sha" ] || exit 1

ack_timeout=300
if [ "$test_mode" = 1 ]; then ack_timeout="${AUTOPILOT_RELEASE_UPDATE_TEST_ACK_TIMEOUT:-1}"; [[ "$ack_timeout" =~ ^[1-5]$ ]] || exit 1; fi
transaction_deadline_epoch="$(( $(date +%s) + ack_timeout ))"
write_ledger waiting
printf 'RELEASE_UPDATE_WAITING_FOR_HOST_ACCEPTANCE ACK_ID=%s\n' "$ack_id"
if [ "$test_mode" = 1 ] && [ "${AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK:-0}" = 1 ]; then
	AUTOPILOT_RELEASE_UPDATE_TEST_ACK_ID="$ack_id" bash "$0" --accept "$ack_id" >/dev/null
fi
deadline=$((SECONDS + ack_timeout))
while (( SECONDS < deadline )); do
	lock_transaction
	observed_state="$(ledger_value state)"
	if [ "$observed_state" != waiting ]; then
		unlock_transaction
		rollback_started=1
		update_started=0
		printf '%s\n' "release update ownership lost to recovery" >&2
		exit 1
	fi
	if safe_regular "$ack_file" && [ "$(stat -c %a -- "$ack_file")" = 600 ] && [ "$(cat "$ack_file")" = "$ack_id" ]; then
		write_ledger completed
		unlock_transaction
		update_started=0
		printf '%s\n' RELEASE_UPDATE_OK
		exit 0
	fi
	unlock_transaction
	sleep 1
done
printf '%s\n' "host acceptance acknowledgement timed out" >&2
exit 1
