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
ledger="$runtime/transaction.ledger"
ack_file="$runtime/host.accepted"

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

if [ "$#" -ne 3 ]; then
	printf '%s\n' "usage: live-cutover.sh CHECKOUT RELEASE_ROOT SHA | --accept ACK_ID" >&2
	exit 1
fi

checkout="$(realpath -e -- "$1")"
release_root="$(realpath -e -- "$2")"
accepted_sha="$3"
[[ "$accepted_sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
[ ! -L "$1" ] && [ ! -L "$2" ] || exit 1
[ "$1" = "$checkout" ] && [ "$2" = "$release_root" ] || exit 1
if [ "$test_mode" = 0 ]; then [ "$release_root" = /srv/autopilot-cockpit ] || exit 1; fi
[ "$(stat -c %u:%g:%a -- "$release_root")" = "$expected_uid:$expected_gid:755" ]
exec {release_lock_fd}<"$release_root"
flock -w 30 "$release_lock_fd"

environment="$(under_root /home/radek/.config/autopilot/control-plane.env)"
caddy_config="$(under_root /etc/caddy/Caddyfile)"
caddy_dropin="$(under_root /etc/systemd/system/caddy.service.d/autopilot.conf)"
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

write_ledger() {
	local state="$1" tmp
	tmp="$(mktemp -- "$runtime/.ledger.XXXXXXXXXX")"
	printf 'version=autopilot-cockpit-cutover-v2\nstate=%s\nack_id=%s\nsha=%s\ncreated_nft_dir=%s\ncreated_helper_dir=%s\ncreated_caddy_dropin_dir=%s\nfirewall_unit_installed=%s\nnft_config_installed=%s\nfirewall_helper_installed=%s\nfirewall_identity_installed=%s\nfirewall_reload_attempted=%s\nfirewall_attempted=%s\nfirewall_started=%s\ncurrent_attempted=%s\ncurrent_switched=%s\nenvironment_attempted=%s\nenvironment_changed=%s\ncontrol_plane_restarted=%s\ncaddy_config_installed=%s\ncaddy_dropin_installed=%s\ncaddy_reload_attempted=%s\ncaddy_unmasked=%s\ncaddy_enabled=%s\ncaddy_attempted=%s\ncaddy_started=%s\n' \
		"$state" "$ack_id" "$accepted_sha" "$created_nft_dir" "$created_helper_dir" "$created_caddy_dropin_dir" "$firewall_unit_installed" "$nft_config_installed" "$firewall_helper_installed" "$firewall_identity_installed" "$firewall_reload_attempted" "$firewall_attempted" "$firewall_started" "$current_attempted" "$current_switched" "$environment_attempted" "$environment_changed" "$control_plane_restarted" "$caddy_config_installed" "$caddy_dropin_installed" "$caddy_reload_attempted" "$caddy_unmasked" "$caddy_enabled" "$caddy_attempted" "$caddy_started" > "$tmp"
	chmod 0600 "$tmp"
	if [ "$test_mode" = 0 ]; then chown 0:0 "$tmp"; fi
	mv -T -- "$tmp" "$ledger"
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
	local state
	state="$(short_command systemctl is-active caddy.service 2>/dev/null)" && return 1
	[ "$state" = inactive ] || [ "$state" = failed ]
}

firewall_inactive() {
	local state
	state="$(short_command systemctl is-active autopilot-cockpit-firewall.service 2>/dev/null)" && return 1
	[ "$state" = inactive ] || [ "$state" = failed ]
}

firewall_installed_identity_valid() {
	[ -f "$firewall_unit" ] && [ ! -L "$firewall_unit" ] && cmp -s "$source_dir/autopilot-cockpit-firewall.service" "$firewall_unit" || return 1
	[ -f "$nft_config" ] && [ ! -L "$nft_config" ] && cmp -s "$source_dir/autopilot-cockpit.nft" "$nft_config" || return 1
	[ -f "$firewall_helper" ] && [ ! -L "$firewall_helper" ] && cmp -s "$source_dir/autopilot-cockpit-firewall.sh" "$firewall_helper" || return 1
	safe_regular "$firewall_identity" && [ "$(stat -c %a "$firewall_identity")" = 600 ] || return 1
	[ "$(cat "$firewall_identity")" = "$ack_id" ] || return 1
	nft_identity_valid
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
	backup="$runtime/backups/$name"
	if [ -e "$path" ] || [ -L "$path" ]; then
		[ -f "$path" ] && [ ! -L "$path" ] || return 1
		if [ -f "$backup" ] && cmp -s "$backup" "$path" && [ "$(stat -c %u:%g:%a:%s:%Y "$backup")" = "$(stat -c %u:%g:%a:%s:%Y "$path")" ]; then return 0; fi
		if [ "$name" = firewall-identity ]; then [ "$(cat "$path")" = "$ack_id" ] || return 1
		else cmp -s "$expected" "$path" || return 1; fi
	elif [ ! -e "$backup" ]; then
		return 0
	fi
	if [ -e "$backup" ]; then
		tmp="$(mktemp -- "$(dirname "$path")/.restore.XXXXXXXXXX")"
		rm -f -- "$tmp"
		cp -a -- "$backup" "$tmp"
		mv -T -- "$tmp" "$path"
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
	local caddy_safe=0 firewall_safe=0 live_state_safe=1
	if [ "$caddy_attempted" = 1 ]; then
		if [ -f "$caddy_config" ] && [ ! -L "$caddy_config" ] && cmp -s "$source_dir/Caddyfile" "$caddy_config"; then
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
		else rollback_failed=1; live_state_safe=0; fi
	else firewall_safe=1
	fi
	if [ "$firewall_safe" = 1 ] && { [ "$firewall_files_installed" = 1 ] || [ "$firewall_identity_installed" = 1 ]; }; then restore_firewall_files; fi
	if [ "$environment_attempted" = 1 ]; then
		if [ -f "$environment" ] && [ ! -L "$environment" ] && cmp -s "$runtime/backups/environment" "$environment" && [ "$(stat -c %u:%g:%a:%s:%Y "$runtime/backups/environment")" = "$(stat -c %u:%g:%a:%s:%Y "$environment")" ]; then :
		elif [ -f "$environment" ] && [ ! -L "$environment" ] && [ "$(sha256sum "$environment" | awk '{print $1}')" = "$environment_owned_hash" ]; then
			tmp_restore="$(mktemp -- "$(dirname "$environment")/.restore-env.XXXXXXXXXX")"
			if ! { rm -f "$tmp_restore" && cp -a "$runtime/backups/environment" "$tmp_restore" && mv -T "$tmp_restore" "$environment"; }; then rollback_failed=1; live_state_safe=0; fi
		else rollback_failed=1; live_state_safe=0; fi
	fi
	if [ "$current_attempted" = 1 ]; then
		if [ "$prior_current_kind" = symlink ] && [ -L "$current" ] && [ "$(readlink "$current")" = "$prior_current_target" ]; then :
		elif [ -L "$current" ] && [ "$(readlink "$current")" = "releases/$accepted_sha" ]; then
			tmp_restore="$release_root/.restore-current-$ack_id"
			if [ "$prior_current_kind" = symlink ]; then { ln -s "$prior_current_target" "$tmp_restore" && mv -T "$tmp_restore" "$current"; } || { rollback_failed=1; live_state_safe=0; }
			else rm -f "$current" || { rollback_failed=1; live_state_safe=0; }; fi
		else rollback_failed=1; live_state_safe=0; fi
	fi
	if [ "$live_state_safe" = 1 ]; then
		short_command systemctl restart autopilot-control-plane.service >/dev/null 2>&1 || rollback_failed=1
		rollback_verification || rollback_failed=1
	fi
	write_ledger rolled-back || rollback_failed=1
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
	exit "$status"
}
on_int() { exit 130; }
on_term() { exit 143; }
trap on_exit EXIT
trap on_int INT
trap on_term TERM

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
[ "$(grep -c '^CONTROL_PLANE_SECURE_COOKIES=' "$environment")" -eq 1 ]
[ "$(grep -c '^CONTROL_PLANE_SECURE_COOKIES=false$' "$environment")" -eq 1 ]
loopback_checks
short_command systemctl is-active autopilot-control-plane.service >/dev/null
short_command systemctl is-active autopilot-control-plane-health.timer >/dev/null
short_command systemctl is-active autopilot-state-maintenance.timer >/dev/null
short_command dpkg -s caddy >/dev/null
caddy_enable_state="$(short_command systemctl is-enabled caddy.service 2>/dev/null)"
case "$caddy_enable_state" in masked|masked-runtime) ;; *) exit 1 ;; esac
if short_command systemctl is-active caddy.service >/dev/null 2>&1; then exit 1; fi
[ -z "$(short_command dpkg -V caddy)" ]
for port in 80 443 8443 8877; do [ -z "$(timeout --signal=TERM --kill-after=2s 5s ss -H -ltn "sport = :$port")" ]; done
for source in Caddyfile autopilot-cockpit.nft autopilot-cockpit-firewall.service autopilot-cockpit-firewall.sh caddy-autopilot.conf; do safe_checkout_regular "$source_dir/$source" || exit 1; done
short_command caddy validate --config "$source_dir/Caddyfile" --adapter caddyfile >/dev/null
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
[ "$(nft_presence)" = absent ]
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

mkdir -m 0700 -- "$runtime"
[ "$(stat -c %u:%g:%a -- "$runtime")" = "$expected_uid:$expected_gid:700" ]
runtime_created=1
mkdir -m 0700 -- "$runtime/backups"
cp -a "$environment" "$runtime/backups/environment"
chmod 0600 "$runtime/backups/environment"
for item in "caddy-config:$caddy_config" "caddy-dropin:$caddy_dropin" "firewall-unit:$firewall_unit" "nft-config:$nft_config" "firewall-helper:$firewall_helper" "firewall-identity:$firewall_identity"; do
	name="${item%%:*}"; path="${item#*:}"
	if [ -e "$path" ]; then [ -f "$path" ] && [ ! -L "$path" ] || exit 1; cp -a "$path" "$runtime/backups/$name"; fi
done
ack_id="${AUTOPILOT_CUTOVER_TEST_ACK_ID:-}"
if [ "$test_mode" = 0 ] || [ -z "$ack_id" ]; then ack_id="$(openssl rand -hex 32)"; fi
[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
write_ledger prepared
recovery_checks
cutover_started=1

if [ ! -d "$(dirname "$nft_config")" ]; then created_nft_dir=1; write_ledger mutating; install -d -m 0755 "$(dirname "$nft_config")"; fi
if [ ! -d "$(dirname "$firewall_helper")" ]; then created_helper_dir=1; write_ledger mutating; install -d -m 0755 "$(dirname "$firewall_helper")"; fi
firewall_files_installed=1
firewall_unit_installed=1; write_ledger mutating
tmp_install="$(mktemp "$(dirname "$firewall_unit")/.firewall-unit.XXXXXXXXXX")"; install -m 0644 "$source_dir/autopilot-cockpit-firewall.service" "$tmp_install"; mv -T "$tmp_install" "$firewall_unit"
fail_after firewall-unit-install
nft_config_installed=1; write_ledger mutating
tmp_install="$(mktemp "$(dirname "$nft_config")/.nft-config.XXXXXXXXXX")"; install -m 0644 "$source_dir/autopilot-cockpit.nft" "$tmp_install"; mv -T "$tmp_install" "$nft_config"
fail_after nft-config-install
firewall_helper_installed=1; write_ledger mutating
tmp_install="$(mktemp "$(dirname "$firewall_helper")/.firewall-helper.XXXXXXXXXX")"; install -m 0755 "$source_dir/autopilot-cockpit-firewall.sh" "$tmp_install"; mv -T "$tmp_install" "$firewall_helper"
fail_after firewall-helper-install
firewall_identity_installed=1; write_ledger mutating
tmp_install="$(mktemp "$(dirname "$firewall_identity")/.firewall-identity.XXXXXXXXXX")"; printf '%s\n' "$ack_id" > "$tmp_install"; chmod 0600 "$tmp_install"; if [ "$test_mode" = 0 ]; then chown 0:0 "$tmp_install"; fi; mv -T "$tmp_install" "$firewall_identity"
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
ln -s "releases/$accepted_sha" "$tmp_current"
current_attempted=1; write_ledger mutating
mv -T -- "$tmp_current" "$current"
current_switched=1; write_ledger mutating; fail_after current
test_pause_after current

tmp_env="$(mktemp -- "$(dirname "$environment")/.control-plane.env.XXXXXXXXXX")"
ENV_INPUT="$environment" ENV_OUTPUT="$tmp_env" "$node_bin" -e '
const fs=require("fs"),b=fs.readFileSync(process.env.ENV_INPUT),s=b.toString("utf8"),lines=s.split("\n");
const matches=lines.map((v,i)=>[v,i]).filter(([v])=>String(v).startsWith("CONTROL_PLANE_SECURE_COOKIES="));
if(matches.length!==1||matches[0][0]!=="CONTROL_PLANE_SECURE_COOKIES=false")process.exit(1);
lines[matches[0][1]]="CONTROL_PLANE_SECURE_COOKIES=true";fs.writeFileSync(process.env.ENV_OUTPUT,Buffer.from(lines.join("\n")));'
chmod 0600 "$tmp_env"
chown "$environment_uid:$environment_gid" "$tmp_env"
environment_owned_hash="$(sha256sum "$tmp_env" | awk '{print $1}')"
environment_attempted=1; write_ledger mutating
mv -T -- "$tmp_env" "$environment"
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
tmp_install="$(mktemp "$(dirname "$caddy_config")/.caddy-config.XXXXXXXXXX")"; install -m 0644 "$source_dir/Caddyfile" "$tmp_install"; mv -T "$tmp_install" "$caddy_config"
fail_after caddy-config-install
caddy_dropin_installed=1; write_ledger mutating
tmp_install="$(mktemp "$(dirname "$caddy_dropin")/.caddy-dropin.XXXXXXXXXX")"; install -m 0644 "$source_dir/caddy-autopilot.conf" "$tmp_install"; mv -T "$tmp_install" "$caddy_dropin"
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
loopback_checks
short_command systemctl is-active autopilot-cockpit-firewall.service >/dev/null
short_command systemctl is-active caddy.service >/dev/null
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
