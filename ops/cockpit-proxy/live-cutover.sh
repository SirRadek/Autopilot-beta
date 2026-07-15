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
environment_changed=0
control_plane_restarted=0
caddy_files_installed=0
firewall_files_installed=0
caddy_started=0
firewall_attempted=0
caddy_unmasked=0
caddy_enabled=0
caddy_attempted=0
runtime_created=0
prior_current_kind=""
prior_current_target=""
prior_caddy_kind=""
ack_id=""

write_ledger() {
	local state="$1" tmp
	tmp="$(mktemp -- "$runtime/.ledger.XXXXXXXXXX")"
	printf 'version=autopilot-cockpit-cutover-v1\nstate=%s\nack_id=%s\nsha=%s\nfirewall_started=%s\ncurrent_switched=%s\nenvironment_changed=%s\ncontrol_plane_restarted=%s\ncaddy_files_installed=%s\ncaddy_started=%s\n' \
		"$state" "$ack_id" "$accepted_sha" "$firewall_started" "$current_switched" "$environment_changed" "$control_plane_restarted" "$caddy_files_installed" "$caddy_started" > "$tmp"
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

restore_configs() {
	local path name backup expected
	for name in caddy-config caddy-dropin firewall-unit nft-config; do
		case "$name" in
			caddy-config|caddy-dropin) [ "$caddy_files_installed" = 1 ] || continue ;;
			firewall-unit|nft-config) [ "$firewall_files_installed" = 1 ] || continue ;;
		esac
		case "$name" in
			caddy-config) path="$caddy_config"; expected="$source_dir/Caddyfile" ;;
			caddy-dropin) path="$caddy_dropin"; expected="$source_dir/caddy-autopilot.conf" ;;
			firewall-unit) path="$firewall_unit"; expected="$source_dir/autopilot-cockpit-firewall.service" ;;
			nft-config) path="$nft_config"; expected="$source_dir/autopilot-cockpit.nft" ;;
		esac
		backup="$runtime/backups/$name"
		if [ ! -f "$path" ] || [ -L "$path" ] || ! cmp -s "$expected" "$path"; then
			rollback_failed=1
			continue
		fi
		if [ -f "$backup" ]; then
			install -m "$(cat "$backup.mode")" "$backup" "$path" || rollback_failed=1
		else
			rm -f -- "$path" || rollback_failed=1
		fi
	done
	short_command systemctl daemon-reload >/dev/null 2>&1 || rollback_failed=1
}

rollback() {
	rollback_started=1
	set +e
	write_ledger rolling-back || rollback_failed=1
	if [ "$caddy_attempted" = 1 ]; then
		cmp -s "$source_dir/Caddyfile" "$caddy_config" && short_command systemctl stop caddy.service >/dev/null 2>&1 || rollback_failed=1
	fi
	if [ "$caddy_enabled" = 1 ]; then short_command systemctl disable caddy.service >/dev/null 2>&1 || rollback_failed=1; fi
	if [ "$caddy_unmasked" = 1 ]; then short_command systemctl mask caddy.service >/dev/null 2>&1 || rollback_failed=1; fi
	if [ "$firewall_attempted" = 1 ]; then
		cmp -s "$source_dir/autopilot-cockpit-firewall.service" "$firewall_unit" && short_command systemctl stop autopilot-cockpit-firewall.service >/dev/null 2>&1 || rollback_failed=1
	fi
	if [ "$caddy_files_installed" = 1 ] || [ "$firewall_files_installed" = 1 ]; then restore_configs; fi
	if [ "$environment_changed" = 1 ]; then
		install -m 0600 "$runtime/backups/environment" "$environment" || rollback_failed=1
		chown "$environment_uid:$environment_gid" "$environment" || rollback_failed=1
	fi
	if [ "$current_switched" = 1 ]; then
		rm -f -- "$current"
		if [ "$prior_current_kind" = symlink ]; then ln -s "$prior_current_target" "$current" || rollback_failed=1; fi
	fi
	short_command systemctl restart autopilot-control-plane.service >/dev/null 2>&1 || rollback_failed=1
	rollback_verification || rollback_failed=1
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
loopback_checks
short_command systemctl is-active autopilot-control-plane.service >/dev/null
short_command systemctl is-active autopilot-control-plane-health.timer >/dev/null
short_command systemctl is-active autopilot-state-maintenance.timer >/dev/null
short_command dpkg -s caddy >/dev/null
[ "$(short_command systemctl is-enabled caddy.service 2>/dev/null)" = masked ]
if short_command systemctl is-active caddy.service >/dev/null 2>&1; then exit 1; fi
[ -z "$(short_command dpkg -V caddy)" ]
for port in 80 443 8443 8877; do [ -z "$(timeout --signal=TERM --kill-after=2s 5s ss -H -ltn "sport = :$port")" ]; done
for source in Caddyfile autopilot-cockpit.nft autopilot-cockpit-firewall.service caddy-autopilot.conf; do safe_checkout_regular "$source_dir/$source" || exit 1; done
short_command caddy validate --config "$source_dir/Caddyfile" --adapter caddyfile >/dev/null
safe_regular "$evidence" && [ "$(stat -c %a -- "$evidence")" = 600 ]
[ "$(cat "$evidence")" = "sha=$accepted_sha
host_acceptance=ok
cleanup=ok" ]
evidence_age="$(( $(date +%s) - $(stat -c %Y "$evidence") ))"
[ "$evidence_age" -ge 0 ] && [ "$evidence_age" -le 3600 ]
for path in "$caddy_dropin" "$firewall_unit" "$nft_config"; do [ ! -e "$path" ] && [ ! -L "$path" ] || exit 1; done
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
cp --preserve=mode,timestamps "$environment" "$runtime/backups/environment"
chmod 0600 "$runtime/backups/environment"
for item in "caddy-config:$caddy_config" "caddy-dropin:$caddy_dropin" "firewall-unit:$firewall_unit" "nft-config:$nft_config"; do
	name="${item%%:*}"; path="${item#*:}"
	if [ -e "$path" ]; then [ -f "$path" ] && [ ! -L "$path" ] || exit 1; cp --preserve=mode,timestamps "$path" "$runtime/backups/$name"; stat -c %a "$path" > "$runtime/backups/$name.mode"; fi
done
ack_id="${AUTOPILOT_CUTOVER_TEST_ACK_ID:-}"
if [ "$test_mode" = 0 ] || [ -z "$ack_id" ]; then ack_id="$(openssl rand -hex 32)"; fi
[[ "$ack_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
write_ledger prepared
recovery_checks
cutover_started=1

install -d -m 0755 "$(dirname "$firewall_unit")" "$(dirname "$nft_config")"
firewall_files_installed=1; write_ledger mutating
install -m 0644 "$source_dir/autopilot-cockpit-firewall.service" "$firewall_unit"
install -m 0644 "$source_dir/autopilot-cockpit.nft" "$nft_config"
short_command systemctl daemon-reload >/dev/null
firewall_attempted=1; write_ledger mutating
short_command systemctl start autopilot-cockpit-firewall.service
firewall_started=1; write_ledger mutating; fail_after firewall

tmp_current="$release_root/.current-$ack_id"
ln -s "releases/$accepted_sha" "$tmp_current"
mv -T -- "$tmp_current" "$current"
current_switched=1; write_ledger mutating; fail_after current

tmp_env="$(mktemp -- "$(dirname "$environment")/.control-plane.env.XXXXXXXXXX")"
awk 'BEGIN{n=0} /^CONTROL_PLANE_SECURE_COOKIES=/{print "CONTROL_PLANE_SECURE_COOKIES=true";n++;next} {print} END{if(n!=1)exit 1}' "$environment" > "$tmp_env"
chmod 0600 "$tmp_env"
chown "$environment_uid:$environment_gid" "$tmp_env"
mv -T -- "$tmp_env" "$environment"
environment_changed=1; write_ledger mutating; fail_after environment

short_command systemctl restart autopilot-control-plane.service
control_plane_restarted=1; write_ledger mutating
loopback_checks
fail_after control-plane

install -d -m 0755 "$(dirname "$caddy_config")" "$(dirname "$caddy_dropin")"
caddy_files_installed=1; write_ledger mutating
install -m 0644 "$source_dir/Caddyfile" "$caddy_config"
install -m 0644 "$source_dir/caddy-autopilot.conf" "$caddy_dropin"
short_command systemctl daemon-reload >/dev/null
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
