#!/bin/bash
set -Eeuo pipefail

# Task 6 installs this file once through the image provisioning boundary.  It is
# deliberately not a checkout installer: production execution is accepted only
# from this fixed, root-owned path.
test_root="${AUTOPILOT_LAUNCHER_TEST_ROOT:-}"
[ "$EUID" -ne 0 ] || [ -z "$test_root" ]
expected_uid=0; expected_gid=0
if [ -n "$test_root" ]; then
	[ -d "$test_root" ] && [ ! -L "$test_root" ] || exit 1
	test_root="$(readlink -f -- "$test_root")"; case "$test_root" in /tmp/*) ;; *) exit 1 ;; esac
	expected_uid="$(id -u)"; expected_gid="$(id -g)"
	PATH="${AUTOPILOT_LAUNCHER_TEST_BIN:-/usr/bin}:/usr/bin:/bin"
else
	PATH=/usr/sbin:/usr/bin:/sbin:/bin
fi
export PATH
trusted_launcher="$test_root/usr/local/sbin/autopilot-cockpit-cutover"
trusted_worker="$test_root/usr/local/libexec/autopilot-cockpit-live-cutover"
trusted_payload="$test_root/usr/local/libexec/autopilot-cockpit-payload"
manifest="$test_root/var/lib/autopilot-cockpit/trusted-payload.manifest"
service="$test_root/etc/systemd/system/autopilot-cockpit-cutover-recovery.service"
timer="$test_root/etc/systemd/system/autopilot-cockpit-cutover-recovery.timer"
timer_unit=autopilot-cockpit-cutover-recovery.timer
authorization="$test_root/etc/autopilot-cockpit/cutover.authorization"
canonical_checkout="/home/radek/autopilot-beta-proxy-candidate"
canonical_origin="https://github.com/SirRadek/Autopilot-beta.git"
cutover_transaction_root="$test_root/var/lib/autopilot-cockpit/transactions"
install_transaction="$test_root/var/lib/autopilot-cockpit/install-transaction"
install_ledger="$install_transaction/transaction.ledger"

if [ -z "$test_root" ]; then
	[ "$EUID" -eq 0 ] || { printf '%s\n' "trusted launcher requires EUID 0" >&2; exit 1; }
fi
[ "$(readlink -f -- "$0")" = "$trusted_launcher" ] || { printf '%s\n' "Task 6 must provision the trusted launcher" >&2; exit 1; }
[ ! -L "$trusted_launcher" ] && [ "$(stat -c %u:%g:%a -- "$trusted_launcher")" = "$expected_uid:$expected_gid:755" ] || exit 1
for trusted_directory in "$test_root/usr/local/libexec" "$test_root/var/lib/autopilot-cockpit" "$test_root/etc/systemd/system"; do
	[ -d "$trusted_directory" ] && [ ! -L "$trusted_directory" ] || exit 1
	trusted_directory_mode="$(stat -c %u:%g:%a -- "$trusted_directory")"
	case "$trusted_directory:$trusted_directory_mode" in
		"$test_root/var/lib/autopilot-cockpit:$expected_uid:$expected_gid:700"|"$test_root/var/lib/autopilot-cockpit:$expected_uid:$expected_gid:755"|*":$expected_uid:$expected_gid:755") ;;
		*) exit 1 ;;
	esac
done

payload_paths=(
	ops/cockpit-proxy/live-cutover.sh
	ops/cockpit-proxy/Caddyfile
	ops/cockpit-proxy/caddy-autopilot.conf
	ops/cockpit-proxy/autopilot-cockpit.nft
	ops/cockpit-proxy/autopilot-cockpit-firewall.sh
	ops/cockpit-proxy/autopilot-cockpit-firewall.service
	ops/cockpit-proxy/autopilot-cockpit-cutover-recovery.service
	ops/cockpit-proxy/autopilot-cockpit-cutover-recovery.timer
	ops/cockpit-proxy/autopilot-cockpit-recovery-verify.sh
	ops/cockpit-proxy/autopilot-cockpit-recovery-smoke.mjs
)
managed_paths=(
	"$trusted_worker" "$service" "$timer"
	"$trusted_payload/Caddyfile" "$trusted_payload/caddy-autopilot.conf"
	"$trusted_payload/autopilot-cockpit.nft" "$trusted_payload/autopilot-cockpit-firewall.sh"
	"$trusted_payload/autopilot-cockpit-firewall.service" "$trusted_payload/autopilot-cockpit-recovery-verify.sh"
	"$trusted_payload/autopilot-cockpit-recovery-smoke.mjs"
)

acquire_root_transaction_lock() {
	if [ -e "$cutover_transaction_root" ] || [ -L "$cutover_transaction_root" ]; then
		[ -d "$cutover_transaction_root" ] && [ ! -L "$cutover_transaction_root" ] && [ "$(stat -c %u:%g:%a -- "$cutover_transaction_root")" = "$expected_uid:$expected_gid:700" ] || return 1
	else
		install -d -o "$expected_uid" -g "$expected_gid" -m 0700 "$cutover_transaction_root"
	fi
	exec {root_transaction_lock_fd}>"$cutover_transaction_root/transaction.lock"
	chmod 0600 "$cutover_transaction_root/transaction.lock"; chown "$expected_uid:$expected_gid" "$cutover_transaction_root/transaction.lock"
	flock -n "$root_transaction_lock_fd" || return 1
	if [ "${AUTOPILOT_LAUNCHER_TEST_HOLD_LOCK:-0}" = 1 ]; then sleep 1; fi
	[ ! -e "$cutover_transaction_root/active" ] && [ ! -L "$cutover_transaction_root/active" ]
}

verify_managed_file() {
	local path="$1" expected_mode="$2" expected_hash="$3"
	[ -f "$path" ] && [ ! -L "$path" ] || return 1
	[ "$(stat -c %u:%g:%a -- "$path")" = "$expected_uid:$expected_gid:$expected_mode" ] || return 1
	[ "$(sha256sum -- "$path" | awk '{print $1}')" = "$expected_hash" ]
}

verify_installed_payload() {
	local count=0 hash mode path
	declare -A seen=()
	[ -f "$manifest" ] && [ ! -L "$manifest" ] && [ "$(stat -c %u:%g:%a -- "$manifest")" = "$expected_uid:$expected_gid:600" ] || return 1
	while IFS=' ' read -r hash mode path; do
		[[ "$hash" =~ ^[a-f0-9]{64}$ ]] && [[ "$mode" =~ ^(644|755)$ ]] || return 1
		case "$path" in "$trusted_worker"|"$trusted_payload"/*|"$service"|"$timer") ;; *) return 1 ;; esac
		[ -z "${seen[$path]:-}" ] || return 1; seen[$path]=1; count=$((count + 1))
		verify_managed_file "$path" "$mode" "$hash" || return 1
	done < "$manifest"
	[ "$count" -eq "${#managed_paths[@]}" ] && [ -n "${seen[$trusted_worker]:-}" ] && [ -n "${seen[$service]:-}" ] && [ -n "${seen[$timer]:-}" ]
}

authorization_value() {
	local key="$1"
	awk -F= -v key="$key" '$1==key { if (++n>1) exit 2; print substr($0,length(key)+2) } END { if(n!=1) exit 2 }' "$authorization"
}

authorized_git() {
	if [ -n "$test_root" ]; then
		/usr/bin/env -i HOME=/home/radek USER=radek LOGNAME=radek PATH=/usr/bin:/bin /usr/bin/git -C "$authorized_checkout" "$@"
	else
		/usr/bin/setpriv --reuid "$authorized_uid" --regid "$authorized_gid" --clear-groups -- /usr/bin/env -i HOME=/home/radek USER=radek LOGNAME=radek PATH=/usr/bin:/bin /usr/bin/git -C "$authorized_checkout" "$@"
	fi
}

validate_authorization() {
	local requested_checkout="$1" requested_sha="$2" count=0 key value canonical_body_hash recorded_id path expected_hash
	declare -A seen=()
	[ -f "$authorization" ] && [ ! -L "$authorization" ] || return 1
	[ "$(stat -c %u:%g:%a -- "$authorization")" = "$expected_uid:$expected_gid:400" ] || return 1
	[ -z "$(tail -c 1 -- "$authorization")" ] || return 1
	while IFS='=' read -r key value; do
		[[ "$key" =~ ^[A-Za-z0-9_.-]+$ && "$value" =~ ^[A-Za-z0-9._/:@+-]+$ ]] || return 1
		[ -z "${seen[$key]:-}" ] || return 1; seen[$key]=1; count=$((count + 1))
	done < "$authorization"
	[ "$count" -eq "$((8 + ${#payload_paths[@]}))" ] || return 1
	[ "$(authorization_value version)" = autopilot-cockpit-authorization-v1 ] || return 1
	authorized_sha="$(authorization_value sha)"; authorized_checkout="$(authorization_value checkout)"; authorized_origin="$(authorization_value origin)"
	authorized_uid="$(authorization_value uid)"; authorized_gid="$(authorization_value gid)"
	[ "$(authorization_value payload_count)" = "${#payload_paths[@]}" ] || return 1
	[[ "$authorized_sha" =~ ^[a-f0-9]{40}$ && "$authorized_uid" =~ ^[0-9]+$ && "$authorized_gid" =~ ^[0-9]+$ ]] || return 1
	[ "$authorized_checkout" = "$requested_checkout" ] && [ "$authorized_sha" = "$requested_sha" ] || return 1
	[ "$(readlink -f -- "$requested_checkout")" = "$requested_checkout" ] || return 1
	if [ -z "$test_root" ]; then
		[ "$authorized_uid" = "$(id -u radek)" ] && [ "$authorized_gid" = "$(id -g radek)" ] || return 1
		[ "$authorized_checkout" = "$canonical_checkout" ] && [ "$authorized_origin" = "$canonical_origin" ] || return 1
	else
		[ "$authorized_uid" = "$(id -u)" ] && [ "$authorized_gid" = "$(id -g)" ] || return 1
		[[ "$authorized_checkout" =~ ^/tmp/[A-Za-z0-9._/-]+$ ]] || return 1
	fi
	[ "$(stat -c %u:%g -- "$authorized_checkout")" = "$authorized_uid:$authorized_gid" ] || return 1
	[ -e "$authorized_checkout/.git" ] && [ ! -L "$authorized_checkout/.git" ] || return 1
	[ -z "$(find -P "$authorized_checkout" -xdev \( ! -uid "$authorized_uid" -o ! -gid "$authorized_gid" \) -print -quit)" ] || return 1
	[ "$(authorized_git rev-parse HEAD)" = "$authorized_sha" ] || return 1
	[ -z "$(authorized_git status --porcelain)" ] || return 1
	[ "$(authorized_git remote get-url origin)" = "$authorized_origin" ] || return 1
	for path in "${payload_paths[@]}"; do
		expected_hash="$(authorization_value "payload.${path##*/}")"; [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || return 1
	done
	recorded_id="$(authorization_value authorization_id)"; [[ "$recorded_id" =~ ^[a-f0-9]{64}$ ]] || return 1
	canonical_body_hash="$(head -n -1 -- "$authorization" | sha256sum | awk '{print $1}')"
	[ "$canonical_body_hash" = "$recorded_id" ]
}

snapshot_from_sha() {
	local checkout="$1" sha="$2" uid gid stage path out mode
	checkout="$(readlink -f -- "$checkout")"
	validate_authorization "$checkout" "$sha" || return 1
	uid="$authorized_uid"; gid="$authorized_gid"
	stage="$(mktemp -d "$test_root/var/lib/autopilot-cockpit/.trusted-payload.XXXXXXXX")"
	chmod 0700 "$stage"; chown "$expected_uid:$expected_gid" "$stage"
	: > "$stage/manifest"
	for path in "${payload_paths[@]}"; do
		out="$stage/${path##*/}"
		if [ -n "$test_root" ]; then
			/usr/bin/env -i HOME=/home/radek USER=radek LOGNAME=radek PATH=/usr/bin:/bin /usr/bin/git -C "$checkout" show "$sha:$path" > "$out" || { rm -rf -- "$stage"; return 1; }
		else
			/usr/bin/setpriv --reuid "$uid" --regid "$gid" --clear-groups -- /usr/bin/env -i HOME=/home/radek USER=radek LOGNAME=radek PATH=/usr/bin:/bin /usr/bin/git -C "$checkout" show "$sha:$path" > "$out" || { rm -rf -- "$stage"; return 1; }
		fi
		[ "$(sha256sum -- "$out" | awk '{print $1}')" = "$(authorization_value "payload.${path##*/}")" ] || { rm -rf -- "$stage"; return 1; }
		mode=644; case "$path" in *.sh) mode=755 ;; esac
		chmod "$mode" "$out"; chown "$expected_uid:$expected_gid" "$out"
		printf '%s %s %s\n' "$(sha256sum -- "$out" | awk '{print $1}')" "$mode" "$path" >> "$stage/manifest"
	done
	chmod 0600 "$stage/manifest"; chown "$expected_uid:$expected_gid" "$stage/manifest"
	printf '%s\n' "$stage"
}

object_identity() { stat -Lc %d:%i:%u:%g:%a:%s:%Y:%Z -- "$1"; }
directory_object_identity() { stat -Lc %d:%i:%u:%g:%a -- "$1"; }

write_install_ledger() {
	local state="$1" attempting="${2:-}" tmp
	tmp="$(mktemp -- "$install_transaction/.ledger.XXXXXXXX")"
	printf 'version=autopilot-cockpit-install-v1\nstate=%s\nattempting=%s\nold_enabled=%s\nold_active=%s\npayload_dir_existed=%s\npayload_dir_identity=%s\n' \
		"$state" "$attempting" "$install_old_enabled" "$install_old_active" "$payload_dir_existed" "$payload_dir_identity" > "$tmp"
	chmod 0600 "$tmp"; chown "$expected_uid:$expected_gid" "$tmp"; /usr/bin/mv -T -- "$tmp" "$install_ledger"
}

install_meta_value() { awk -F= -v key="$2" '$1==key {value=substr($0,length(key)+2)} END {print value}' "$install_transaction/meta/$1"; }

recover_install_transaction() {
	local key path prior_kind prior_identity new_identity temp_path backup live_identity failed=0
	[ -d "$install_transaction" ] && [ ! -L "$install_transaction" ] && [ "$(stat -c %u:%g:%a -- "$install_transaction")" = "$expected_uid:$expected_gid:700" ] || return 1
	[ -f "$install_ledger" ] && [ ! -L "$install_ledger" ] && [ "$(stat -c %u:%g:%a -- "$install_ledger")" = "$expected_uid:$expected_gid:600" ] || return 1
	install_old_enabled="$(awk -F= '$1=="old_enabled"{print $2}' "$install_ledger")"; install_old_active="$(awk -F= '$1=="old_active"{print $2}' "$install_ledger")"
	payload_dir_existed="$(awk -F= '$1=="payload_dir_existed"{print $2}' "$install_ledger")"; payload_dir_identity="$(awk -F= '$1=="payload_dir_identity"{print $2}' "$install_ledger")"
	for meta in "$install_transaction"/meta/*; do
		[ -f "$meta" ] || continue; key="${meta##*/}"; path="$(install_meta_value "$key" path)"; prior_kind="$(install_meta_value "$key" prior_kind)"
		prior_identity="$(install_meta_value "$key" prior_identity)"; new_identity="$(install_meta_value "$key" new_identity)"; temp_path="$(install_meta_value "$key" temp_path)"; backup="$install_transaction/backups/$key"
		if [ -n "$temp_path" ] && { [ -e "$temp_path" ] || [ -L "$temp_path" ]; }; then
			[ -n "$new_identity" ] && [ "$(object_identity "$temp_path" 2>/dev/null)" = "$new_identity" ] && rm -f -- "$temp_path" || failed=1
		fi
		if [ -e "$path" ] || [ -L "$path" ]; then live_identity="$(object_identity "$path" 2>/dev/null || :)"; else live_identity=absent; fi
		if [ "$prior_kind" = file ] && [ "$live_identity" = "$prior_identity" ]; then continue
		elif [ "$prior_kind" = absent ] && [ "$live_identity" = absent ]; then continue
		elif [ -n "$new_identity" ] && [ "$live_identity" = "$new_identity" ]; then
			if [ "$prior_kind" = file ]; then tmp_restore="$(mktemp -- "$(dirname "$path")/.install-restore.XXXXXXXX")"; cp -a -- "$backup" "$tmp_restore" || { failed=1; continue; }; [ "$(object_identity "$path")" = "$new_identity" ] && /usr/bin/mv -T -- "$tmp_restore" "$path" || { rm -f "$tmp_restore"; failed=1; }
			else rm -f -- "$path" || failed=1; fi
		else failed=1
		fi
	done
	if [ "$payload_dir_existed" = 0 ] && [ -d "$trusted_payload" ] && [ ! -L "$trusted_payload" ]; then
		[ -n "$payload_dir_identity" ] && [ "$(directory_object_identity "$trusted_payload")" = "$payload_dir_identity" ] && rmdir -- "$trusted_payload" || failed=1
	fi
	systemctl daemon-reload || failed=1
	case "$install_old_enabled" in enabled) systemctl unmask "$timer_unit" >/dev/null 2>&1 && systemctl enable "$timer_unit" >/dev/null || failed=1 ;; disabled) systemctl unmask "$timer_unit" >/dev/null 2>&1 || :; systemctl disable "$timer_unit" >/dev/null || failed=1 ;; masked) systemctl mask "$timer_unit" >/dev/null || failed=1 ;; masked-runtime) systemctl mask --runtime "$timer_unit" >/dev/null || failed=1 ;; *) failed=1 ;; esac
	case "$install_old_active" in active) systemctl start "$timer_unit" || failed=1 ;; inactive) systemctl stop "$timer_unit" || failed=1 ;; *) failed=1 ;; esac
	[ "$(systemctl is-enabled "$timer_unit" 2>/dev/null || :)" = "$install_old_enabled" ] || failed=1
	[ "$(systemctl is-active "$timer_unit" 2>/dev/null || :)" = "$install_old_active" ] || failed=1
	[ "$failed" = 0 ] || return 1
	rm -rf -- "$install_transaction"
}

publish_install_file() {
	local source="$1" destination="$2" mode="$3" key="$(basename "$2")" meta="$install_transaction/meta/$(basename "$2")" tmp prior_identity
	prior_identity="$(install_meta_value "$key" prior_identity)"
	if [ "$(install_meta_value "$key" prior_kind)" = file ]; then [ "$(object_identity "$destination")" = "$prior_identity" ] || return 1; else [ ! -e "$destination" ] && [ ! -L "$destination" ] || return 1; fi
	tmp="$(mktemp -- "$(dirname "$destination")/.autopilot-watchdog.XXXXXXXX")" || return 1
	install -o "$expected_uid" -g "$expected_gid" -m "$mode" "$source" "$tmp" || { rm -f "$tmp"; return 1; }
	printf 'new_identity=%s\ntemp_path=%s\n' "$(object_identity "$tmp")" "$tmp" >> "$meta"
	write_install_ledger publishing "$key"
	mv -T -- "$tmp" "$destination" || return 1
	if { [ "${AUTOPILOT_LAUNCHER_TEST_KILL_AFTER:-}" = worker ] && [ "$destination" = "$trusted_worker" ]; } || [ "${AUTOPILOT_LAUNCHER_TEST_KILL_AFTER:-}" = "$key" ]; then kill -KILL $$; fi
}

install_snapshot() {
	local stage="$1" item source destination mode hash key prior_kind prior_identity prior_hash new_hash
	install_old_enabled="$(systemctl is-enabled "$timer_unit" 2>/dev/null || :)"; [ -n "$install_old_enabled" ] || install_old_enabled=disabled
	install_old_active="$(systemctl is-active "$timer_unit" 2>/dev/null || :)"; [ -n "$install_old_active" ] || install_old_active=inactive
	case "$install_old_enabled" in enabled|disabled|masked|masked-runtime) ;; *) return 1 ;; esac; case "$install_old_active" in active|inactive) ;; *) return 1 ;; esac
	for item in "${managed_paths[@]}" "$manifest"; do if [ -e "$item" ] || [ -L "$item" ]; then verify_installed_payload || { printf '%s\n' "refusing foreign installed watchdog payload" >&2; return 1; }; break; fi; done
	payload_dir_existed=0; payload_dir_identity=""
	if [ -e "$trusted_payload" ] || [ -L "$trusted_payload" ]; then [ -d "$trusted_payload" ] && [ ! -L "$trusted_payload" ] && [ "$(stat -c %u:%g:%a -- "$trusted_payload")" = "$expected_uid:$expected_gid:755" ] || return 1; payload_dir_existed=1; payload_dir_identity="$(directory_object_identity "$trusted_payload")"; fi
	[ ! -e "$install_transaction" ] && [ ! -L "$install_transaction" ] || return 1
	mkdir -m 0700 -- "$install_transaction"; chown "$expected_uid:$expected_gid" "$install_transaction"; mkdir -m 0700 "$install_transaction/backups" "$install_transaction/meta"
	awk -v worker="$trusted_worker" -v payload="$trusted_payload" -v service="$service" -v timer="$timer" '{p=$3;sub(/^.*\//,"",p);if($3~/live-cutover/)p=worker;else if($3~/recovery.service/)p=service;else if($3~/recovery.timer/)p=timer;else p=payload "/" p;print $1,$2,p}' "$stage/manifest" > "$stage/installed-manifest"
	for item in "${managed_paths[@]}" "$manifest"; do
		key="$(basename "$item")"; prior_kind=absent; prior_identity=""; prior_hash=""
		if [ -e "$item" ]; then prior_kind=file; prior_identity="$(object_identity "$item")"; prior_hash="$(sha256sum "$item"|awk '{print $1}')"; cp -a "$item" "$install_transaction/backups/$key"; fi
		if [ "$item" = "$manifest" ]; then source="$stage/installed-manifest"; mode=600
		elif [ "$item" = "$trusted_worker" ]; then source="$stage/live-cutover.sh"; mode=755
		else source="$stage/$key"; mode="$(awk -v p="$item" '$3==p{print $2}' "$stage/installed-manifest")"; fi
		new_hash="$(sha256sum "$source"|awk '{print $1}')"
		printf 'path=%s\nprior_kind=%s\nprior_identity=%s\nprior_hash=%s\nnew_hash=%s\nnew_mode=%s\nnew_identity=\ntemp_path=\n' "$item" "$prior_kind" "$prior_identity" "$prior_hash" "$new_hash" "$mode" > "$install_transaction/meta/$key"
	done
	write_install_ledger prepared
	if [ "$payload_dir_existed" = 0 ]; then write_install_ledger publishing payload-dir; install -d -o "$expected_uid" -g "$expected_gid" -m 0755 "$trusted_payload" || { recover_install_transaction; return 1; }; payload_dir_identity="$(directory_object_identity "$trusted_payload")"; write_install_ledger publishing payload-dir-created; fi
	while IFS=' ' read -r hash mode item; do source="$stage/${item##*/}"; case "$item" in ops/cockpit-proxy/live-cutover.sh) destination="$trusted_worker" ;; ops/cockpit-proxy/autopilot-cockpit-cutover-recovery.service) destination="$service" ;; ops/cockpit-proxy/autopilot-cockpit-cutover-recovery.timer) destination="$timer" ;; *) destination="$trusted_payload/${item##*/}" ;; esac; publish_install_file "$source" "$destination" "$mode" || { recover_install_transaction; return 1; }; done < "$stage/manifest"
	publish_install_file "$stage/installed-manifest" "$manifest" 0600 || { recover_install_transaction; return 1; }
	write_install_ledger systemd daemon-reload; systemctl daemon-reload || { recover_install_transaction; return 1; }
	write_install_ledger systemd enable; systemctl enable "$timer_unit" >/dev/null || { recover_install_transaction; return 1; }
	write_install_ledger systemd start; systemctl start "$timer_unit" || { recover_install_transaction; return 1; }
	[ "$(systemctl is-enabled "$timer_unit")" = enabled ] && [ "$(systemctl is-active "$timer_unit")" = active ] && verify_installed_payload || { recover_install_transaction; return 1; }
	rm -rf -- "$install_transaction"
}

case "${1:-}" in
	--recover|--accept)
		verify_installed_payload
		exec "$trusted_worker" "$@"
		;;
	--recover-install)
		[ "$#" -eq 1 ] || exit 64
		acquire_root_transaction_lock
		recover_install_transaction
		printf '%s\n' INSTALL_RECOVERY_OK
		;;
	--install-watchdog)
		[ "$#" -eq 3 ] || exit 64
		acquire_root_transaction_lock
		if [ -e "$install_transaction" ] || [ -L "$install_transaction" ]; then recover_install_transaction; fi
		stage="$(snapshot_from_sha "$2" "$3")"; trap 'rm -rf -- "${stage:-}"' EXIT
		install_snapshot "$stage"
		printf '%s\n' WATCHDOG_READY
		;;
	*)
		[ "$#" -eq 3 ] || exit 64
		acquire_root_transaction_lock
		if [ -e "$install_transaction" ] || [ -L "$install_transaction" ]; then recover_install_transaction; fi
		stage="$(snapshot_from_sha "$1" "$3")"; trap 'rm -rf -- "${stage:-}"' EXIT
		install_snapshot "$stage"
		rm -rf -- "$stage"; stage=""; trap - EXIT
		exec "$trusted_worker" "$@"
		;;
esac
