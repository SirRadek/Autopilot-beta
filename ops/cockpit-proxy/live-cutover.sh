#!/usr/bin/env bash
set -Eeuo pipefail

test_mode="${AUTOPILOT_CUTOVER_TEST_MODE:-0}"
case "$test_mode" in 0|1) ;; *) exit 1 ;; esac
if [ "$test_mode" = 0 ]; then
	PATH=/usr/sbin:/usr/bin:/sbin:/bin
	export PATH
	[ "$EUID" -eq 0 ] || { printf '%s\n' "live cutover requires EUID 0" >&2; exit 1; }
fi

root="${AUTOPILOT_CUTOVER_TEST_ROOT:-}"
if [ "$test_mode" = 0 ]; then
	[ -z "$root" ] || exit 1
else
	[ -n "$root" ] && [ -d "$root" ] && [ ! -L "$root" ] || exit 1
	root="$(realpath -e -- "$root")"
	case "$root" in /tmp/*) ;; *) exit 1 ;; esac
fi
expected_uid=0
expected_gid=0
if [ "$test_mode" = 1 ]; then expected_uid="$(id -u)"; expected_gid="$(id -g)"; fi
checkout_uid=""
checkout_gid=""
environment_uid=""
environment_gid=""

under_root() {
	local value="$1"
	if [ -n "$root" ]; then printf '%s%s\n' "$root" "$value"; else printf '%s\n' "$value"; fi
}

short_command() {
	timeout --signal=TERM --kill-after=5s 30s "$@"
}

long_command() {
	timeout --signal=TERM --kill-after=10s 180s "$@"
}

project_long() {
	(
		cd "$checkout"
		long_command npm --silent "$@"
	)
}

runtime="$(under_root /run/autopilot-cockpit-cutover)"
transaction_root="$(under_root /var/lib/autopilot-cockpit/transactions)"
transaction_dir="$transaction_root/active"
ledger="$transaction_dir/transaction.ledger"
runtime_ledger="$runtime/transaction.ledger"
ack_file="$runtime/host.accepted"

inspect_command() {
	inspection_output=""
	if inspection_output="$("$@")"; then inspection_rc=0; else inspection_rc=$?; fi
}

ledger_value() {
	local key="$1"
	awk -F= -v key="$key" '$1 == key { if (++n > 1) exit 2; print substr($0, length(key) + 2) } END { if (n != 1) exit 2 }' "$ledger"
}

safe_regular() {
	[ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u:%g -- "$1")" = "$expected_uid:$expected_gid" ]
}

safe_checkout_regular() {
	[ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u:%g -- "$1")" = "$checkout_uid:$checkout_gid" ]
}

safe_owned_directory() {
	[ -d "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u:%g:%a "$1")" = "$expected_uid:$expected_gid:755" ]
}

safe_owned_symlink() {
	[ -L "$1" ] && [ "$(stat -c %u:%g "$1")" = "$expected_uid:$expected_gid" ]
}

if [ "${1:-}" = "--accept" ]; then
	[ "$#" -eq 2 ] || exit 1
	ack_id="$2"
	[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || { printf '%s\n' "invalid acknowledgement ID" >&2; exit 1; }
	[ -d "$runtime" ] && [ ! -L "$runtime" ] || exit 1
	[ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ] || exit 1
	safe_regular "$ledger" && [ "$(stat -c %a -- "$ledger")" = 600 ] || exit 1
	[ "$(sed -n 's/^state=//p' "$ledger")" = waiting ] || exit 1
	[ "$(sed -n 's/^ack_id=//p' "$ledger")" = "$ack_id" ] || exit 1
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
	printf '%s\n' "CUTOVER_HOST_ACCEPTANCE_ACKNOWLEDGED"
	exit 0
fi

recover_mode=0
if [ "${1:-}" = "--recover" ]; then
	[ "$#" -eq 1 ] || exit 1
	recover_mode=1
elif [ "$#" -ne 3 ]; then
	printf '%s\n' "usage: live-cutover.sh CHECKOUT RELEASE_ROOT SHA | --accept ACK_ID | --recover" >&2
	exit 1
fi

if [ "$recover_mode" = 1 ]; then
	safe_regular "$ledger" && [ "$(stat -c %a -- "$ledger")" = 600 ] || { printf '%s\n' RECOVERY_NOT_NEEDED; exit 0; }
	case "$(ledger_value state)" in completed|rolled-back) printf '%s\n' RECOVERY_NOT_NEEDED; exit 0 ;; esac
	checkout="$(ledger_value checkout)"
	release_root="$(ledger_value release_root)"
	accepted_sha="$(ledger_value sha)"
else
	checkout="$(realpath -e -- "$1")"
	release_root="$(realpath -e -- "$2")"
	accepted_sha="$3"
fi
[[ "$accepted_sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
if [ "$recover_mode" = 0 ]; then
	[ ! -L "$1" ] && [ ! -L "$2" ] || exit 1
	[ "$1" = "$checkout" ] && [ "$2" = "$release_root" ] || exit 1
else
	[ "$(realpath -e -- "$checkout")" = "$checkout" ] && [ "$(realpath -e -- "$release_root")" = "$release_root" ] || exit 1
fi
if [ "$test_mode" = 0 ]; then [ "$release_root" = /srv/autopilot-cockpit ] || exit 1; fi
[ "$(stat -c %u:%g:%a -- "$release_root")" = "$expected_uid:$expected_gid:755" ]
exec {release_lock_fd}<"$release_root"
flock -w 30 "$release_lock_fd"

environment="$(under_root /home/radek/.config/autopilot/control-plane.env)"
caddy_config="$(under_root /etc/caddy/Caddyfile)"
caddy_dropin="$(under_root /etc/systemd/system/caddy.service.d/autopilot.conf)"
package_caddy_unit="$(under_root /usr/lib/systemd/system/caddy.service)"
recovery_program="$(under_root /usr/local/libexec/autopilot-cockpit-live-cutover)"
recovery_service="$(under_root /etc/systemd/system/autopilot-cockpit-cutover-recovery.service)"
recovery_timer="$(under_root /etc/systemd/system/autopilot-cockpit-cutover-recovery.timer)"
recovery_timer_enable="$(under_root /etc/systemd/system/timers.target.wants/autopilot-cockpit-cutover-recovery.timer)"
firewall_unit="$(under_root /etc/systemd/system/autopilot-cockpit-firewall.service)"
nft_config="$(under_root /etc/nftables.d/autopilot-cockpit.nft)"
firewall_helper="$(under_root /usr/local/libexec/autopilot-cockpit-firewall)"
firewall_identity="$(under_root /var/lib/autopilot-cockpit/firewall.identity)"
persistent_mask="$(under_root /etc/systemd/system/caddy.service)"
runtime_mask="$(under_root /run/systemd/system/caddy.service)"
persistent_enable="$(under_root /etc/systemd/system/multi-user.target.wants/caddy.service)"
runtime_enable="$(under_root /run/systemd/system/multi-user.target.wants/caddy.service)"
evidence="$(under_root "/var/lib/autopilot-cockpit/isolated-acceptance/$accepted_sha.ok")"
release="$release_root/releases/$accepted_sha"
manifest="$release_root/manifests/$accepted_sha.sha256"
current="$release_root/current"
source_dir="$checkout/ops/cockpit-proxy"
checkout_uid="$(stat -c %u -- "$checkout")"
checkout_gid="$(stat -c %g -- "$checkout")"
node_bin="${AUTOPILOT_NODE_BIN:-/usr/bin/node}"

cutover_started=0
rollback_started=0
rollback_failed=0
firewall_started=0
current_switched=0
current_attempted=0
environment_changed=0
environment_attempted=0
environment_owned_hash=""
control_plane_restarted=0
caddy_files_installed=0
caddy_config_installed=0
caddy_dropin_installed=0
caddy_reload_attempted=0
firewall_files_installed=0
firewall_unit_installed=0
nft_config_installed=0
firewall_helper_installed=0
firewall_identity_installed=0
firewall_reload_attempted=0
caddy_started=0
firewall_attempted=0
caddy_unmasked=0
caddy_enabled=0
caddy_attempted=0
runtime_created=0
transaction_created=0
created_nft_dir=0
created_helper_dir=0
created_caddy_dropin_dir=0
prior_mask_kind=""
prior_persistent_enable=0
prior_runtime_enable=0
prior_persistent_enable_target=""
prior_runtime_enable_target=""
prior_current_kind=""
prior_current_target=""
prior_caddy_kind=""
ack_id=""
package_caddy_unit_hash=""
package_caddy_unit_metadata=""
registered_temp_path=""
registered_temp_kind=""
registered_temp_identity=""

write_ledger() {
	local state="$1" tmp
	tmp="$(mktemp -- "$transaction_dir/.ledger.XXXXXXXXXX")"
	printf 'version=autopilot-cockpit-cutover-v3\nstate=%s\nack_id=%s\nsha=%s\ncheckout=%s\nrelease_root=%s\nowner_pid=%s\nboot_id=%s\ndeadline_epoch=%s\nprior_mask_kind=%s\nprior_persistent_enable=%s\nprior_runtime_enable=%s\nprior_persistent_enable_target=%s\nprior_runtime_enable_target=%s\nprior_current_kind=%s\nprior_current_target=%s\nenvironment_owned_hash=%s\npackage_caddy_unit_hash=%s\npackage_caddy_unit_metadata=%s\nregistered_temp_path=%s\nregistered_temp_kind=%s\nregistered_temp_identity=%s\ncreated_nft_dir=%s\ncreated_helper_dir=%s\ncreated_caddy_dropin_dir=%s\nfirewall_unit_installed=%s\nnft_config_installed=%s\nfirewall_helper_installed=%s\nfirewall_identity_installed=%s\nfirewall_reload_attempted=%s\nfirewall_attempted=%s\nfirewall_started=%s\ncurrent_attempted=%s\ncurrent_switched=%s\nenvironment_attempted=%s\nenvironment_changed=%s\ncontrol_plane_restarted=%s\ncaddy_files_installed=%s\ncaddy_config_installed=%s\ncaddy_dropin_installed=%s\ncaddy_reload_attempted=%s\ncaddy_unmasked=%s\ncaddy_enabled=%s\ncaddy_attempted=%s\ncaddy_started=%s\n' \
		"$state" "$ack_id" "$accepted_sha" "$checkout" "$release_root" "${transaction_owner_pid:-$$}" "${transaction_boot_id:-unknown}" "${transaction_deadline_epoch:-0}" "$prior_mask_kind" "$prior_persistent_enable" "$prior_runtime_enable" "$prior_persistent_enable_target" "$prior_runtime_enable_target" "$prior_current_kind" "$prior_current_target" "$environment_owned_hash" "$package_caddy_unit_hash" "$package_caddy_unit_metadata" "$registered_temp_path" "$registered_temp_kind" "$registered_temp_identity" "$created_nft_dir" "$created_helper_dir" "$created_caddy_dropin_dir" "$firewall_unit_installed" "$nft_config_installed" "$firewall_helper_installed" "$firewall_identity_installed" "$firewall_reload_attempted" "$firewall_attempted" "$firewall_started" "$current_attempted" "$current_switched" "$environment_attempted" "$environment_changed" "$control_plane_restarted" "$caddy_files_installed" "$caddy_config_installed" "$caddy_dropin_installed" "$caddy_reload_attempted" "$caddy_unmasked" "$caddy_enabled" "$caddy_attempted" "$caddy_started" > "$tmp"
	chmod 0600 "$tmp"
	if [ "$test_mode" = 0 ]; then chown 0:0 "$tmp"; fi
	mv -T -- "$tmp" "$ledger"
	if [ -d "$runtime" ] && [ ! -L "$runtime" ]; then
		tmp="$(mktemp -- "$runtime/.ledger.XXXXXXXXXX")"
		cp -- "$ledger" "$tmp" && chmod 0600 "$tmp" && { [ "$test_mode" = 1 ] || chown 0:0 "$tmp"; } && mv -T -- "$tmp" "$runtime_ledger"
	fi
}

temp_identity() {
	if [ "$1" = file ]; then sha256sum "$2" | awk '{print $1}'
	elif [ "$1" = symlink ]; then printf '%s' "$(readlink -- "$2")" | sha256sum | awk '{print $1}'
	else return 1; fi
}

register_temp() {
	local ledger_state="${4:-mutating}"
	[ -z "$registered_temp_path" ] || return 1
	registered_temp_path="$1"; registered_temp_kind="$2"; registered_temp_identity="$3"
	[ ! -e "$registered_temp_path" ] && [ ! -L "$registered_temp_path" ]
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
	if [ "$test_mode" = 1 ] && [ "${AUTOPILOT_CUTOVER_TEST_FAIL_AFTER:-}" = "$1" ]; then
		printf 'injected failure after %s\n' "$1" >&2
		return 75
	fi
}

test_pause_after() {
	if [ "$test_mode" = 1 ] && [ "${AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER:-}" = "$1" ]; then sleep 5; fi
}

nft_presence() {
	local json
	json="$(short_command nft -j list tables)" || return 2
	NFT_JSON="$json" "$node_bin" -e '
const d=JSON.parse(process.env.NFT_JSON);const m=(d.nftables??[]).filter(x=>x.table?.family==="inet"&&x.table?.name==="autopilot_cockpit");
if(m.length>1)process.exit(2);process.stdout.write(m.length?"present":"absent");' || return 2
}

nft_absent_exact() {
	inspect_command nft_presence
	[ "$inspection_rc" -eq 0 ] && [ "$inspection_output" = absent ]
}

nft_identity_valid() {
	local json
	json="$(short_command nft -j list table inet autopilot_cockpit)" || return 2
	NFT_JSON="$json" NFT_NONCE="$ack_id" "$node_bin" -e '
const d=JSON.parse(process.env.NFT_JSON),e=d.nftables??[],c=`autopilot-cockpit:${process.env.NFT_NONCE}`;
const t=e.filter(x=>x.table?.family==="inet"&&x.table?.name==="autopilot_cockpit");
const ch=e.filter(x=>x.chain?.family==="inet"&&x.chain?.table==="autopilot_cockpit"&&x.chain?.name==="input");
const r=e.filter(x=>x.rule?.family==="inet"&&x.rule?.table==="autopilot_cockpit"&&x.rule?.chain==="input");
if(t.length!==1||ch.length!==1||r.length!==1||t[0].table.comment!==c||ch[0].chain.comment!==c||r[0].rule.comment!==c)process.exit(1);
const chain=ch[0].chain;if(chain.type!=="filter"||chain.hook!=="input"||chain.prio!==-10||chain.policy!=="accept")process.exit(1);
const x=[{match:{op:"==",left:{payload:{protocol:"tcp",field:"dport"}},right:{set:[80,443]}}},{match:{op:"!=",left:{payload:{protocol:"ip",field:"saddr"}},right:"192.168.122.1"}},{drop:null}];
if(JSON.stringify(r[0].rule.expr)!==JSON.stringify(x))process.exit(1);'
}

caddy_ports_absent() {
	local port output
	for port in 80 443; do
		output="$(short_command ss -H -ltn "sport = :$port")" || return 2
		[ -z "$output" ] || return 1
	done
}

caddy_inactive() {
	inspect_command short_command systemctl is-active caddy.service
	[ "$inspection_rc" -eq 3 ] && { [ "$inspection_output" = inactive ] || [ "$inspection_output" = failed ]; }
}

firewall_inactive() {
	inspect_command short_command systemctl is-active autopilot-cockpit-firewall.service
	[ "$inspection_rc" -eq 3 ] && { [ "$inspection_output" = inactive ] || [ "$inspection_output" = failed ]; }
}

caddy_installed_identity_valid() {
	[ -f "$caddy_config" ] && [ ! -L "$caddy_config" ] && cmp -s "$source_dir/Caddyfile" "$caddy_config" || return 1
	[ -f "$caddy_dropin" ] && [ ! -L "$caddy_dropin" ] && cmp -s "$source_dir/caddy-autopilot.conf" "$caddy_dropin" || return 1
	[ -f "$package_caddy_unit" ] && [ ! -L "$package_caddy_unit" ] || return 1
	[ "$(sha256sum "$package_caddy_unit" | awk '{print $1}')" = "$package_caddy_unit_hash" ] || return 1
	[ "$(stat -c %u:%g:%a "$package_caddy_unit")" = "$package_caddy_unit_metadata" ]
}

firewall_installed_identity_valid() {
	firewall_files_identity_valid || return 1
	nft_identity_valid
}

firewall_files_identity_valid() {
	[ -f "$firewall_unit" ] && [ ! -L "$firewall_unit" ] && cmp -s "$source_dir/autopilot-cockpit-firewall.service" "$firewall_unit" || return 1
	[ -f "$nft_config" ] && [ ! -L "$nft_config" ] && cmp -s "$source_dir/autopilot-cockpit.nft" "$nft_config" || return 1
	[ -f "$firewall_helper" ] && [ ! -L "$firewall_helper" ] && cmp -s "$source_dir/autopilot-cockpit-firewall.sh" "$firewall_helper" || return 1
	safe_regular "$firewall_identity" && [ "$(stat -c %a "$firewall_identity")" = 600 ] || return 1
	[ "$(cat "$firewall_identity")" = "$ack_id" ] || return 1
}

validate_secure_cookie_environment() {
	ENV_INPUT="$1" "$node_bin" -e '
const fs=require("fs"),{TextDecoder}=require("util"),b=fs.readFileSync(process.env.ENV_INPUT);
let s;try{s=new TextDecoder("utf-8",{fatal:true}).decode(b)}catch{process.exit(1)}
if(s.includes("\0"))process.exit(1);
const lines=s.split("\n"),mentions=lines.filter(v=>v.includes("CONTROL_PLANE_SECURE_COOKIES"));
if(mentions.length!==1||mentions[0]!=="CONTROL_PLANE_SECURE_COOKIES=false")process.exit(1);'
}

validate_ready_file() {
	READY_JSON_PATH="$1" "$node_bin" -e '
const b=JSON.parse(require("fs").readFileSync(process.env.READY_JSON_PATH,"utf8"));
if(b?.ready!==true)process.exit(1);
for(const n of ["configuration","managed_state","project_registry","supervisor","token_gateway"])
 if(b?.components?.[n]?.status!=="ready"||b.components[n].error_code!==null)process.exit(1);'
}

loopback_checks() {
	local work health_status ready_status checks_parent
	checks_parent=/tmp
	if [ -d "$runtime" ] && [ ! -L "$runtime" ]; then checks_parent="$runtime"; fi
	work="$(mktemp -d -- "$checks_parent/.autopilot-cutover-checks.XXXXXXXXXX")"
	health_status="$(short_command curl --disable --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 5 --output "$work/health.json" --write-out '%{http_code}' http://127.0.0.1:8787/health)"
	[ "$health_status" = 200 ]
	HEALTH_JSON_PATH="$work/health.json" "$node_bin" -e 'const b=JSON.parse(require("fs").readFileSync(process.env.HEALTH_JSON_PATH));if(b?.ok!==true)process.exit(1)'
	ready_status="$(short_command curl --disable --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 5 --output "$work/ready.json" --write-out '%{http_code}' http://127.0.0.1:8787/ready)"
	[ "$ready_status" = 200 ] && validate_ready_file "$work/ready.json"
	local listener
	listener="$(short_command ss -H -ltn "sport = :8787")"
	[ "$(printf '%s\n' "$listener" | sed '/^$/d' | wc -l)" -eq 1 ]
	[[ "$listener" == *"127.0.0.1:8787"* ]]
	[[ "$listener" != *"0.0.0.0:8787"* && "$listener" != *"[::]:8787"* ]]
	rm -rf -- "$work"
}

recovery_checks() {
	local state_dir projects_dir backup_dir backup_json archive recovery_json
	state_dir="$(sed -n 's/^AUTOPILOT_STATE_DIR=//p' "$environment")"
	projects_dir="$(sed -n 's/^AUTOPILOT_PROJECTS_DIR=//p' "$environment")"
	[ -n "$state_dir" ] && [ -n "$projects_dir" ]
	if [ "$test_mode" = 1 ]; then state_dir="$(under_root "$state_dir")"; projects_dir="$(under_root "$projects_dir")"; fi
	backup_dir="$(under_root /home/radek/.local/state/autopilot/backups)"
	mkdir -p -- "$backup_dir"
	backup_json="$(project_long run ops:backup -- "$state_dir" "$backup_dir")"
	archive="$(BACKUP_JSON="$backup_json" "$node_bin" -e 'const b=JSON.parse(process.env.BACKUP_JSON);if(b?.validation?.valid!==true||typeof b.path!=="string")process.exit(1);process.stdout.write(b.path)')"
	[ -f "$archive" ] && [ ! -L "$archive" ]
	recovery_json="$(project_long run ops:recovery-drill -- "$archive")"
	RECOVERY_JSON="$recovery_json" "$node_bin" -e 'const b=JSON.parse(process.env.RECOVERY_JSON);if(b?.ok!==true||b?.validation?.ready!==true||b?.validation?.reconciled!==true||(b.validation.errors??[]).length)process.exit(1)'
}

rollback_verification() {
	loopback_checks
	local state_dir projects_dir
	state_dir="$(sed -n 's/^AUTOPILOT_STATE_DIR=//p' "$environment")"
	projects_dir="$(sed -n 's/^AUTOPILOT_PROJECTS_DIR=//p' "$environment")"
	if [ "$test_mode" = 1 ]; then state_dir="$(under_root "$state_dir")"; projects_dir="$(under_root "$projects_dir")"; fi
	project_long run ops:boundary-check -- "$checkout" "$state_dir" "$projects_dir" >/dev/null
	local smoke
	smoke="$(project_long run smoke:cockpit-run -- --dry-run)"
	SMOKE_JSON="$smoke" "$node_bin" -e 'const b=JSON.parse(process.env.SMOKE_JSON);if(b?.provider_invoked!==false||b?.run_status!=="completed")process.exit(1)'
}

restore_one() {
	local name="$1" path="$2" expected="$3" attempted="$4" backup tmp
	[ "$attempted" = 1 ] || return 0
	backup="$transaction_dir/backups/$name"
	if [ -e "$path" ] || [ -L "$path" ]; then
		[ -f "$path" ] && [ ! -L "$path" ] || return 1
		if [ -f "$backup" ] && cmp -s "$backup" "$path" && [ "$(stat -c %u:%g:%a:%s:%Y "$backup")" = "$(stat -c %u:%g:%a:%s:%Y "$path")" ]; then return 0; fi
		if [ "$name" = firewall-identity ]; then [ "$(cat "$path")" = "$ack_id" ] || return 1
		else cmp -s "$expected" "$path" || return 1; fi
	elif [ ! -e "$backup" ]; then
		return 0
	fi
	if [ -e "$backup" ]; then
		tmp="$(dirname "$path")/.restore-$name-$ack_id"
		register_temp "$tmp" file "$(sha256sum "$backup" | awk '{print $1}')" rolling-back || return 1
		cp -a -- "$backup" "$tmp"
		mv -T -- "$tmp" "$path"
		clear_registered_temp rolling-back || return 1
	else
		rm -f -- "$path"
	fi
}

restore_caddy_files() {
	restore_one caddy-config "$caddy_config" "$source_dir/Caddyfile" "$caddy_config_installed" || rollback_failed=1
	restore_one caddy-dropin "$caddy_dropin" "$source_dir/caddy-autopilot.conf" "$caddy_dropin_installed" || rollback_failed=1
	short_command systemctl daemon-reload >/dev/null 2>&1 || rollback_failed=1
	if [ "$created_caddy_dropin_dir" = 1 ]; then rmdir -- "$(dirname "$caddy_dropin")" 2>/dev/null || rollback_failed=1; fi
}

restore_firewall_files() {
	restore_one firewall-unit "$firewall_unit" "$source_dir/autopilot-cockpit-firewall.service" "$firewall_unit_installed" || rollback_failed=1
	restore_one nft-config "$nft_config" "$source_dir/autopilot-cockpit.nft" "$nft_config_installed" || rollback_failed=1
	restore_one firewall-helper "$firewall_helper" "$source_dir/autopilot-cockpit-firewall.sh" "$firewall_helper_installed" || rollback_failed=1
	restore_one firewall-identity "$firewall_identity" /dev/null "$firewall_identity_installed" || rollback_failed=1
	short_command systemctl daemon-reload >/dev/null 2>&1 || rollback_failed=1
	if [ "$created_nft_dir" = 1 ]; then rmdir -- "$(dirname "$nft_config")" 2>/dev/null || rollback_failed=1; fi
	if [ "$created_helper_dir" = 1 ]; then rmdir -- "$(dirname "$firewall_helper")" 2>/dev/null || rollback_failed=1; fi
}

restore_enable_link() {
	local path="$1" existed="$2" target="$3"
	if [ "$existed" = 1 ]; then
		if [ -L "$path" ]; then [ "$(readlink "$path")" = "$target" ] || return 1
		elif [ ! -e "$path" ]; then ln -s "$target" "$path"
		else return 1; fi
	else
		[ ! -e "$path" ] && [ ! -L "$path" ]
	fi
}

rollback() {
	rollback_started=1
	set +e
	write_ledger rolling-back || rollback_failed=1
	clear_registered_temp rolling-back || rollback_failed=1
	local caddy_safe=0 firewall_safe=0 live_state_safe=1
	if [ "$caddy_attempted" = 1 ]; then
		if caddy_installed_identity_valid; then
			if short_command systemctl stop caddy.service >/dev/null 2>&1; then
				if caddy_inactive && caddy_ports_absent; then caddy_safe=1; else rollback_failed=1; fi
			else rollback_failed=1; fi
		else
			rollback_failed=1
		fi
	else
		if caddy_inactive && caddy_ports_absent; then caddy_safe=1; else rollback_failed=1; fi
	fi
	if [ "$caddy_enabled" = 1 ]; then
		short_command systemctl disable caddy.service >/dev/null 2>&1 || rollback_failed=1
		restore_enable_link "$persistent_enable" "$prior_persistent_enable" "$prior_persistent_enable_target" || rollback_failed=1
		restore_enable_link "$runtime_enable" "$prior_runtime_enable" "$prior_runtime_enable_target" || rollback_failed=1
	fi
	if [ "$caddy_unmasked" = 1 ]; then
		case "$prior_mask_kind" in
			runtime) short_command systemctl mask --runtime caddy.service >/dev/null 2>&1 || rollback_failed=1 ;;
			persistent) short_command systemctl mask caddy.service >/dev/null 2>&1 || rollback_failed=1 ;;
			*) rollback_failed=1 ;;
		esac
		case "$prior_mask_kind" in
			runtime) [ -L "$runtime_mask" ] && [ "$(readlink "$runtime_mask")" = /dev/null ] && [ ! -e "$persistent_mask" ] && [ ! -L "$persistent_mask" ] || rollback_failed=1 ;;
			persistent) [ -L "$persistent_mask" ] && [ "$(readlink "$persistent_mask")" = /dev/null ] && [ ! -e "$runtime_mask" ] && [ ! -L "$runtime_mask" ] || rollback_failed=1 ;;
		esac
	fi
	if [ "$caddy_files_installed" = 1 ]; then restore_caddy_files; fi
	if [ "$firewall_attempted" = 1 ]; then
		if [ "$caddy_safe" = 1 ] && firewall_installed_identity_valid; then
			if short_command systemctl stop autopilot-cockpit-firewall.service >/dev/null 2>&1 && firewall_inactive && [ "$(nft_presence)" = absent ]; then firewall_safe=1; else rollback_failed=1; fi
		elif [ "$caddy_safe" = 1 ] && firewall_files_identity_valid && nft_absent_exact && short_command systemctl stop autopilot-cockpit-firewall.service >/dev/null 2>&1 && firewall_inactive && nft_absent_exact; then
			# The owned service may fail before nft creates its table.  With an
			# exact inactive state and proven table absence, only files changed.
			firewall_safe=1
		else rollback_failed=1; live_state_safe=0; fi
	else firewall_safe=1
	fi
	if [ "$firewall_safe" = 1 ] && { [ "$firewall_files_installed" = 1 ] || [ "$firewall_identity_installed" = 1 ]; }; then restore_firewall_files; fi
	if [ "$environment_attempted" = 1 ]; then
		if [ -f "$environment" ] && [ ! -L "$environment" ] && cmp -s "$transaction_dir/backups/environment" "$environment" && [ "$(stat -c %u:%g:%a:%s:%Y "$transaction_dir/backups/environment")" = "$(stat -c %u:%g:%a:%s:%Y "$environment")" ]; then :
		elif [ -f "$environment" ] && [ ! -L "$environment" ] && [ "$(sha256sum "$environment" | awk '{print $1}')" = "$environment_owned_hash" ]; then
			tmp_restore="$(dirname "$environment")/.restore-env-$ack_id"
			if ! { register_temp "$tmp_restore" file "$(sha256sum "$transaction_dir/backups/environment" | awk '{print $1}')" rolling-back && cp -a "$transaction_dir/backups/environment" "$tmp_restore" && mv -T "$tmp_restore" "$environment" && clear_registered_temp rolling-back; }; then rollback_failed=1; live_state_safe=0; fi
		else rollback_failed=1; live_state_safe=0; fi
	fi
	if [ "$current_attempted" = 1 ]; then
		if [ "$prior_current_kind" = symlink ] && [ -L "$current" ] && [ "$(readlink "$current")" = "$prior_current_target" ]; then :
		elif [ -L "$current" ] && [ "$(readlink "$current")" = "releases/$accepted_sha" ]; then
			tmp_restore="$release_root/.restore-current-$ack_id"
			if [ "$prior_current_kind" = symlink ]; then { register_temp "$tmp_restore" symlink "$(printf '%s' "$prior_current_target" | sha256sum | awk '{print $1}')" rolling-back && ln -s "$prior_current_target" "$tmp_restore" && mv -T "$tmp_restore" "$current" && clear_registered_temp rolling-back; } || { rollback_failed=1; live_state_safe=0; }
			else rm -f "$current" || { rollback_failed=1; live_state_safe=0; }; fi
		else rollback_failed=1; live_state_safe=0; fi
	fi
	if [ "$live_state_safe" = 1 ]; then
		short_command systemctl restart autopilot-control-plane.service >/dev/null 2>&1 || rollback_failed=1
		rollback_verification || rollback_failed=1
	fi
	if [ "$rollback_failed" = 0 ]; then
		write_ledger rolled-back || rollback_failed=1
	else
		write_ledger rollback-failed || rollback_failed=1
	fi
	if [ "$rollback_failed" = 0 ]; then printf '%s\n' ROLLBACK_OK; else printf '%s\n' ROLLBACK_FAILED; fi
	set -e
}

on_exit() {
	local status=$?
	trap - EXIT INT TERM
	if (( status != 0 && cutover_started == 1 && rollback_started == 0 )); then rollback; fi
	if (( status != 0 && cutover_started == 0 && runtime_created == 1 )); then
		[ -d "$runtime" ] && [ ! -L "$runtime" ] && [ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ] && rm -rf -- "$runtime"
	fi
	if (( status != 0 && cutover_started == 0 && transaction_created == 1 )); then
		[ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(stat -c %u:%g:%a -- "$transaction_dir")" = "$expected_uid:$expected_gid:700" ] && rm -rf -- "$transaction_dir"
	fi
	exit "$status"
}
on_int() { exit 130; }
on_term() { exit 143; }
trap on_exit EXIT
trap on_int INT
trap on_term TERM

if [ "$recover_mode" = 1 ]; then
	[ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(stat -c %u:%g:%a "$transaction_dir")" = "$expected_uid:$expected_gid:700" ] || exit 1
	exec {transaction_lock_fd}>"$transaction_root/recovery.lock"
	flock -w 30 "$transaction_lock_fd"
	state="$(ledger_value state)"
	case "$state" in completed|rolled-back) printf '%s\n' RECOVERY_NOT_NEEDED; exit 0 ;; prepared|mutating|verifying|waiting|rolling-back|rollback-failed) ;; *) exit 1 ;; esac
	transaction_owner_pid="$(ledger_value owner_pid)"
	transaction_boot_id="$(ledger_value boot_id)"
	transaction_deadline_epoch="$(ledger_value deadline_epoch)"
	[[ "$transaction_owner_pid" =~ ^[0-9]+$ && "$transaction_deadline_epoch" =~ ^[0-9]+$ ]] || exit 1
	current_boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)"
	if [ "$transaction_boot_id" = "$current_boot_id" ] && kill -0 "$transaction_owner_pid" 2>/dev/null && [ "$(date +%s)" -le "$transaction_deadline_epoch" ]; then
		printf '%s\n' RECOVERY_OWNER_ACTIVE
		exit 0
	fi
	ack_id="$(ledger_value ack_id)"
	[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
	prior_mask_kind="$(ledger_value prior_mask_kind)"
	case "$prior_mask_kind" in persistent|runtime) ;; *) exit 1 ;; esac
	prior_persistent_enable_target="$(ledger_value prior_persistent_enable_target)"
	prior_runtime_enable_target="$(ledger_value prior_runtime_enable_target)"
	prior_current_kind="$(ledger_value prior_current_kind)"
	prior_current_target="$(ledger_value prior_current_target)"
	case "$prior_current_kind" in ''|symlink) ;; *) exit 1 ;; esac
	if [ "$prior_current_kind" = symlink ]; then [[ "$prior_current_target" =~ ^releases/[a-f0-9]{40}$ ]] || exit 1; fi
	environment_owned_hash="$(ledger_value environment_owned_hash)"
	package_caddy_unit_hash="$(ledger_value package_caddy_unit_hash)"
	package_caddy_unit_metadata="$(ledger_value package_caddy_unit_metadata)"
	[[ "$package_caddy_unit_hash" =~ ^[a-f0-9]{64}$ && "$package_caddy_unit_metadata" =~ ^[0-9]+:[0-9]+:[0-7]{3,4}$ ]] || exit 1
	registered_temp_path="$(ledger_value registered_temp_path)"
	registered_temp_kind="$(ledger_value registered_temp_kind)"
	registered_temp_identity="$(ledger_value registered_temp_identity)"
	if [ -n "$registered_temp_path" ]; then
		case "$registered_temp_kind" in file|symlink) ;; *) exit 1 ;; esac
		[[ "$registered_temp_identity" =~ ^[a-f0-9]{64}$ ]] || exit 1
		case "$registered_temp_path" in
			"$transaction_dir/.nft-check-$ack_id"|"$(dirname "$firewall_unit")/.firewall-unit-$ack_id"|"$(dirname "$nft_config")/.nft-config-$ack_id"|"$(dirname "$firewall_helper")/.firewall-helper-$ack_id"|"$(dirname "$firewall_identity")/.firewall-identity-$ack_id"|"$release_root/.current-$ack_id"|"$(dirname "$environment")/.control-plane.env-$ack_id"|"$(dirname "$caddy_config")/.caddy-config-$ack_id"|"$(dirname "$caddy_dropin")/.caddy-dropin-$ack_id"|"$(dirname "$caddy_config")/.restore-caddy-config-$ack_id"|"$(dirname "$caddy_dropin")/.restore-caddy-dropin-$ack_id"|"$(dirname "$firewall_unit")/.restore-firewall-unit-$ack_id"|"$(dirname "$nft_config")/.restore-nft-config-$ack_id"|"$(dirname "$firewall_helper")/.restore-firewall-helper-$ack_id"|"$(dirname "$firewall_identity")/.restore-firewall-identity-$ack_id"|"$(dirname "$environment")/.restore-env-$ack_id"|"$release_root/.restore-current-$ack_id") ;;
			*) exit 1 ;;
		esac
	else
		[ -z "$registered_temp_kind" ] && [ -z "$registered_temp_identity" ] || exit 1
	fi
	for flag in prior_persistent_enable prior_runtime_enable created_nft_dir created_helper_dir created_caddy_dropin_dir firewall_unit_installed nft_config_installed firewall_helper_installed firewall_identity_installed firewall_reload_attempted firewall_attempted firewall_started current_attempted current_switched environment_attempted environment_changed control_plane_restarted caddy_files_installed caddy_config_installed caddy_dropin_installed caddy_reload_attempted caddy_unmasked caddy_enabled caddy_attempted caddy_started; do
		value="$(ledger_value "$flag")"
		case "$value" in 0|1) printf -v "$flag" '%s' "$value" ;; *) exit 1 ;; esac
	done
	cutover_started=1
	rollback
	[ "$rollback_failed" = 0 ]
	exit
fi

# Complete every refusal check before creating the transaction runtime or touching live state.
[ -x "$node_bin" ] && case "$(short_command "$node_bin" --version)" in v24.*) ;; *) exit 1 ;; esac
[ "$(git -C "$checkout" rev-parse HEAD)" = "$accepted_sha" ]
[ -z "$(git -C "$checkout" status --porcelain)" ]
[ -d "$release" ] && [ ! -L "$release" ] && safe_regular "$manifest"
[ "$(stat -c %a -- "$manifest")" = 444 ]
[ -z "$(find -P "$release" -mindepth 1 ! -type d ! -type f -print -quit)" ]
[ -z "$(find -P "$release" -type d \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0555 \) -print -quit)" ]
[ -z "$(find -P "$release" -type f \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0444 \) -print -quit)" ]
cmp -s <(cd "$checkout/cockpit/dist" && find -P . -mindepth 1 -printf '%y %P\0' | LC_ALL=C sort -z) <(cd "$release" && find -P . -mindepth 1 -printf '%y %P\0' | LC_ALL=C sort -z)
cmp -s "$manifest" <(cd "$release" && find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)
(cd "$release" && sha256sum --check --strict "$manifest" >/dev/null)
[ -f "$environment" ] && [ ! -L "$environment" ] && [ "$(stat -c %a -- "$environment")" = 600 ]
environment_uid="$(stat -c %u -- "$environment")"
environment_gid="$(stat -c %g -- "$environment")"
if [ "$test_mode" = 0 ]; then [ "$environment_uid" = "$(id -u radek)" ] && [ "$environment_gid" = "$(id -g radek)" ]; fi
validate_secure_cookie_environment "$environment"
loopback_checks
short_command systemctl is-active autopilot-control-plane.service >/dev/null
short_command systemctl is-active autopilot-control-plane-health.timer >/dev/null
short_command systemctl is-active autopilot-state-maintenance.timer >/dev/null
short_command dpkg -s caddy >/dev/null
caddy_enable_state="$(short_command systemctl is-enabled caddy.service 2>/dev/null)"
case "$caddy_enable_state" in masked|masked-runtime) ;; *) exit 1 ;; esac
inspect_command short_command systemctl is-active caddy.service
if [ "$inspection_rc" -ne 3 ] || { [ "$inspection_output" != inactive ] && [ "$inspection_output" != failed ]; }; then exit 1; fi
inspect_command short_command dpkg -V caddy
if [ "$inspection_rc" -ne 0 ] || [ -n "$inspection_output" ]; then exit 1; fi
for port in 80 443 8443 8877; do
	inspect_command timeout --signal=TERM --kill-after=2s 5s ss -H -ltn "sport = :$port"
	if [ "$inspection_rc" -ne 0 ] || [ -n "$inspection_output" ]; then exit 1; fi
done
for source in Caddyfile autopilot-cockpit.nft autopilot-cockpit-firewall.service autopilot-cockpit-firewall.sh caddy-autopilot.conf autopilot-cockpit-cutover-recovery.service autopilot-cockpit-cutover-recovery.timer; do safe_checkout_regular "$source_dir/$source" || exit 1; done
short_command caddy validate --config "$source_dir/Caddyfile" --adapter caddyfile >/dev/null
[ -f "$recovery_program" ] && [ ! -L "$recovery_program" ] && [ "$(stat -c %u:%g:%a "$recovery_program")" = "$expected_uid:$expected_gid:755" ] && cmp -s "$0" "$recovery_program"
[ -f "$recovery_service" ] && [ ! -L "$recovery_service" ] && [ "$(stat -c %u:%g:%a "$recovery_service")" = "$expected_uid:$expected_gid:644" ] && cmp -s "$source_dir/autopilot-cockpit-cutover-recovery.service" "$recovery_service"
[ -f "$recovery_timer" ] && [ ! -L "$recovery_timer" ] && [ "$(stat -c %u:%g:%a "$recovery_timer")" = "$expected_uid:$expected_gid:644" ] && cmp -s "$source_dir/autopilot-cockpit-cutover-recovery.timer" "$recovery_timer"
safe_owned_symlink "$recovery_timer_enable" && [ "$(readlink "$recovery_timer_enable")" = ../autopilot-cockpit-cutover-recovery.timer ]
inspect_command short_command systemctl is-active autopilot-cockpit-cutover-recovery.timer
if [ "$inspection_rc" -ne 0 ] || { [ "$test_mode" = 0 ] && [ "$inspection_output" != active ]; }; then exit 1; fi
safe_regular "$evidence" && [ "$(stat -c %a -- "$evidence")" = 600 ]
[ "$(cat "$evidence")" = "sha=$accepted_sha
host_acceptance=ok
cleanup=ok" ]
evidence_age="$(( $(date +%s) - $(stat -c %Y "$evidence") ))"
[ "$evidence_age" -ge 0 ] && [ "$evidence_age" -le 3600 ]
if [ -e "$caddy_config" ] || [ -L "$caddy_config" ]; then
	[ -f "$caddy_config" ] && [ ! -L "$caddy_config" ] && [ "$(stat -c %u:%g:%a "$caddy_config")" = "$expected_uid:$expected_gid:644" ] || exit 1
fi
safe_owned_directory "$(dirname "$caddy_config")"
safe_owned_directory "$(dirname "$firewall_unit")"
safe_owned_directory "$(dirname "$firewall_identity")"
for path in "$caddy_dropin" "$firewall_unit" "$nft_config" "$firewall_helper" "$firewall_identity"; do [ ! -e "$path" ] && [ ! -L "$path" ] || exit 1; done
inspect_command nft_presence
if [ "$inspection_rc" -ne 0 ] || [ "$inspection_output" != absent ]; then exit 1; fi
if safe_owned_symlink "$runtime_mask" && [ "$(readlink "$runtime_mask")" = /dev/null ] && [ ! -e "$persistent_mask" ] && [ ! -L "$persistent_mask" ]; then
	prior_mask_kind=runtime
elif safe_owned_symlink "$persistent_mask" && [ "$(readlink "$persistent_mask")" = /dev/null ] && [ ! -e "$runtime_mask" ] && [ ! -L "$runtime_mask" ]; then
	prior_mask_kind=persistent
else exit 1
fi
[ "$prior_mask_kind:$caddy_enable_state" = persistent:masked ] || [ "$prior_mask_kind:$caddy_enable_state" = runtime:masked-runtime ]
if safe_owned_symlink "$persistent_enable"; then prior_persistent_enable=1; prior_persistent_enable_target="$(readlink "$persistent_enable")"; elif [ -e "$persistent_enable" ] || [ -L "$persistent_enable" ]; then exit 1; fi
if safe_owned_symlink "$runtime_enable"; then prior_runtime_enable=1; prior_runtime_enable_target="$(readlink "$runtime_enable")"; elif [ -e "$runtime_enable" ] || [ -L "$runtime_enable" ]; then exit 1; fi
if [ -e "$current" ] || [ -L "$current" ]; then
	[ -L "$current" ] || exit 1
	prior_current_kind=symlink
	prior_current_target="$(readlink -- "$current")"
	[[ "$prior_current_target" =~ ^releases/[a-f0-9]{40}$ ]] || exit 1
fi

[ -f "$package_caddy_unit" ] && [ ! -L "$package_caddy_unit" ]
package_caddy_unit_metadata="$(stat -c %u:%g:%a "$package_caddy_unit")"
[ "$package_caddy_unit_metadata" = "$expected_uid:$expected_gid:644" ]
package_caddy_unit_hash="$(sha256sum "$package_caddy_unit" | awk '{print $1}')"

install -d -m 0700 "$transaction_root"
[ "$(stat -c %u:%g:%a -- "$transaction_root")" = "$expected_uid:$expected_gid:700" ]
mkdir -m 0700 -- "$transaction_dir"
transaction_created=1
mkdir -m 0700 -- "$runtime"
[ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ]
runtime_created=1
mkdir -m 0700 -- "$transaction_dir/backups"
cp -a "$environment" "$transaction_dir/backups/environment"
chmod 0600 "$transaction_dir/backups/environment"
for item in "caddy-config:$caddy_config" "caddy-dropin:$caddy_dropin" "firewall-unit:$firewall_unit" "nft-config:$nft_config" "firewall-helper:$firewall_helper" "firewall-identity:$firewall_identity"; do
	name="${item%%:*}"; path="${item#*:}"
	if [ -e "$path" ]; then [ -f "$path" ] && [ ! -L "$path" ] || exit 1; cp -a "$path" "$transaction_dir/backups/$name"; fi
done
ack_id="${AUTOPILOT_CUTOVER_TEST_ACK_ID:-}"
if [ "$test_mode" = 0 ] || [ -z "$ack_id" ]; then ack_id="$(openssl rand -hex 32)"; fi
[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
transaction_owner_pid="$$"
transaction_boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)"
transaction_deadline_epoch="$(( $(date +%s) + 600 ))"
write_ledger prepared

rendered_nft="$transaction_dir/.nft-check-$ack_id"
rendered_identity="$(NFT_TEMPLATE="$source_dir/autopilot-cockpit.nft" NFT_NONCE="$ack_id" "$node_bin" -e 'const fs=require("fs"),s=fs.readFileSync(process.env.NFT_TEMPLATE,"utf8"),p="__AUTOPILOT_COCKPIT_NONCE__";if((s.match(new RegExp(p,"g"))||[]).length!==3)process.exit(1);process.stdout.write(s.split(p).join(process.env.NFT_NONCE))' | sha256sum | awk '{print $1}')"
register_temp "$rendered_nft" file "$rendered_identity"
NFT_TEMPLATE="$source_dir/autopilot-cockpit.nft" NFT_OUTPUT="$rendered_nft" NFT_NONCE="$ack_id" "$node_bin" -e '
const fs=require("fs"),s=fs.readFileSync(process.env.NFT_TEMPLATE,"utf8"),p="__AUTOPILOT_COCKPIT_NONCE__";
if((s.match(new RegExp(p,"g"))||[]).length!==3)process.exit(1);
fs.writeFileSync(process.env.NFT_OUTPUT,s.split(p).join(process.env.NFT_NONCE),{mode:0o600});'
chmod 0600 "$rendered_nft"
short_command nft --check --file "$rendered_nft"
clear_registered_temp
recovery_checks
cutover_started=1

if [ ! -d "$(dirname "$nft_config")" ]; then created_nft_dir=1; write_ledger mutating; install -d -m 0755 "$(dirname "$nft_config")"; fi
if [ ! -d "$(dirname "$firewall_helper")" ]; then created_helper_dir=1; write_ledger mutating; install -d -m 0755 "$(dirname "$firewall_helper")"; fi
firewall_files_installed=1
firewall_unit_installed=1; write_ledger mutating
tmp_install="$(dirname "$firewall_unit")/.firewall-unit-$ack_id"; register_temp "$tmp_install" file "$(sha256sum "$source_dir/autopilot-cockpit-firewall.service" | awk '{print $1}')"; install -m 0644 "$source_dir/autopilot-cockpit-firewall.service" "$tmp_install"; mv -T "$tmp_install" "$firewall_unit"; clear_registered_temp
fail_after firewall-unit-install
nft_config_installed=1; write_ledger mutating
tmp_install="$(dirname "$nft_config")/.nft-config-$ack_id"; register_temp "$tmp_install" file "$(sha256sum "$source_dir/autopilot-cockpit.nft" | awk '{print $1}')"; install -m 0644 "$source_dir/autopilot-cockpit.nft" "$tmp_install"; mv -T "$tmp_install" "$nft_config"; clear_registered_temp
fail_after nft-config-install
firewall_helper_installed=1; write_ledger mutating
tmp_install="$(dirname "$firewall_helper")/.firewall-helper-$ack_id"; register_temp "$tmp_install" file "$(sha256sum "$source_dir/autopilot-cockpit-firewall.sh" | awk '{print $1}')"; install -m 0755 "$source_dir/autopilot-cockpit-firewall.sh" "$tmp_install"; mv -T "$tmp_install" "$firewall_helper"; clear_registered_temp
fail_after firewall-helper-install
firewall_identity_installed=1; write_ledger mutating
tmp_install="$(dirname "$firewall_identity")/.firewall-identity-$ack_id"; register_temp "$tmp_install" file "$(printf '%s\n' "$ack_id" | sha256sum | awk '{print $1}')"; printf '%s\n' "$ack_id" > "$tmp_install"; chmod 0600 "$tmp_install"; if [ "$test_mode" = 0 ]; then chown 0:0 "$tmp_install"; fi; mv -T "$tmp_install" "$firewall_identity"; clear_registered_temp
fail_after firewall-identity-install
firewall_reload_attempted=1; write_ledger mutating
short_command systemctl daemon-reload >/dev/null
fail_after firewall-reload
firewall_attempted=1; write_ledger mutating
short_command systemctl start autopilot-cockpit-firewall.service
firewall_started=1; write_ledger mutating
firewall_installed_identity_valid
fail_after firewall

tmp_current="$release_root/.current-$ack_id"
register_temp "$tmp_current" symlink "$(printf '%s' "releases/$accepted_sha" | sha256sum | awk '{print $1}')"
ln -s "releases/$accepted_sha" "$tmp_current"
current_attempted=1; write_ledger mutating
mv -T -- "$tmp_current" "$current"
clear_registered_temp
current_switched=1; write_ledger mutating; fail_after current
test_pause_after current

tmp_env="$(dirname "$environment")/.control-plane.env-$ack_id"
environment_expected_hash="$(ENV_INPUT="$environment" "$node_bin" -e 'const fs=require("fs"),b=fs.readFileSync(process.env.ENV_INPUT),f=Buffer.from("CONTROL_PLANE_SECURE_COOKIES=false"),t=Buffer.from("CONTROL_PLANE_SECURE_COOKIES=true"),i=b.indexOf(f);if(i<0||b.indexOf(f,i+1)>=0)process.exit(1);process.stdout.write(Buffer.concat([b.subarray(0,i),t,b.subarray(i+f.length)]))' | sha256sum | awk '{print $1}')"
register_temp "$tmp_env" file "$environment_expected_hash"
ENV_INPUT="$environment" ENV_OUTPUT="$tmp_env" "$node_bin" -e '
const fs=require("fs"),{TextDecoder}=require("util"),b=fs.readFileSync(process.env.ENV_INPUT);
let s;try{s=new TextDecoder("utf-8",{fatal:true}).decode(b)}catch{process.exit(1)}
const from="CONTROL_PLANE_SECURE_COOKIES=false",to="CONTROL_PLANE_SECURE_COOKIES=true";
if(s.split(from).length!==2||s.split("\n").filter(v=>v.includes("CONTROL_PLANE_SECURE_COOKIES")).length!==1)process.exit(1);
fs.writeFileSync(process.env.ENV_OUTPUT,Buffer.from(s.replace(from,to),"utf8"));'
chmod 0600 "$tmp_env"
chown "$environment_uid:$environment_gid" "$tmp_env"
environment_owned_hash="$(sha256sum "$tmp_env" | awk '{print $1}')"
environment_attempted=1; write_ledger mutating
mv -T -- "$tmp_env" "$environment"
clear_registered_temp
environment_changed=1; write_ledger mutating; fail_after environment
test_pause_after environment

short_command systemctl restart autopilot-control-plane.service
control_plane_restarted=1; write_ledger mutating
loopback_checks
fail_after control-plane

install -d -m 0755 "$(dirname "$caddy_config")"
if [ ! -d "$(dirname "$caddy_dropin")" ]; then created_caddy_dropin_dir=1; write_ledger mutating; install -d -m 0755 "$(dirname "$caddy_dropin")"; fi
caddy_files_installed=1
caddy_config_installed=1; write_ledger mutating
tmp_install="$(dirname "$caddy_config")/.caddy-config-$ack_id"; register_temp "$tmp_install" file "$(sha256sum "$source_dir/Caddyfile" | awk '{print $1}')"; install -m 0644 "$source_dir/Caddyfile" "$tmp_install"; mv -T "$tmp_install" "$caddy_config"; clear_registered_temp
fail_after caddy-config-install
caddy_dropin_installed=1; write_ledger mutating
tmp_install="$(dirname "$caddy_dropin")/.caddy-dropin-$ack_id"; register_temp "$tmp_install" file "$(sha256sum "$source_dir/caddy-autopilot.conf" | awk '{print $1}')"; install -m 0644 "$source_dir/caddy-autopilot.conf" "$tmp_install"; mv -T "$tmp_install" "$caddy_dropin"; clear_registered_temp
fail_after caddy-dropin-install
caddy_reload_attempted=1; write_ledger mutating
short_command systemctl daemon-reload >/dev/null
fail_after caddy-reload
fail_after caddy-files

caddy_unmasked=1; write_ledger mutating
short_command systemctl unmask caddy.service >/dev/null
caddy_enabled=1; write_ledger mutating
short_command systemctl enable caddy.service >/dev/null
caddy_attempted=1; write_ledger mutating
short_command systemctl start caddy.service
caddy_started=1; write_ledger verifying
fail_after caddy
caddy_installed_identity_valid
loopback_checks
inspect_command short_command systemctl is-active autopilot-cockpit-firewall.service
if [ "$inspection_rc" -ne 0 ] || [ "$inspection_output" != active ]; then exit 1; fi
inspect_command short_command systemctl is-active caddy.service
if [ "$inspection_rc" -ne 0 ] || [ "$inspection_output" != active ]; then exit 1; fi
caddy_installed_identity_valid
for port in 80 443; do
	listener="$(short_command ss -H -ltn "sport = :$port")"
	[ "$(printf '%s\n' "$listener" | sed '/^$/d' | wc -l)" -eq 1 ]
	[[ "$listener" == *"192.168.122.99:$port"* ]]
	[[ "$listener" != *"0.0.0.0:$port"* && "$listener" != *"[::]:$port"* ]]
done

write_ledger waiting
printf 'CUTOVER_WAITING_FOR_HOST_ACCEPTANCE ACK_ID=%s\n' "$ack_id"
if [ "$test_mode" = 1 ] && [ "${AUTOPILOT_CUTOVER_TEST_AUTO_ACK:-0}" = 1 ]; then
	AUTOPILOT_CUTOVER_TEST_ACK_ID="$ack_id" bash "$0" --accept "$ack_id" >/dev/null
fi
ack_timeout=300
if [ "$test_mode" = 1 ]; then ack_timeout="${AUTOPILOT_CUTOVER_TEST_ACK_TIMEOUT:-1}"; [[ "$ack_timeout" =~ ^[1-5]$ ]] || exit 1; fi
deadline=$((SECONDS + ack_timeout))
while (( SECONDS < deadline )); do
	if safe_regular "$ack_file" && [ "$(stat -c %a -- "$ack_file")" = 600 ] && [ "$(cat "$ack_file")" = "$ack_id" ]; then
		write_ledger completed
		cutover_started=0
		printf '%s\n' CUTOVER_OK
		exit 0
	fi
	sleep 1
done
printf '%s\n' "host acceptance acknowledgement timed out" >&2
exit 1
