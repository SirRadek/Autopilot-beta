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
)
managed_paths=(
	"$trusted_worker" "$service" "$timer"
	"$trusted_payload/Caddyfile" "$trusted_payload/caddy-autopilot.conf"
	"$trusted_payload/autopilot-cockpit.nft" "$trusted_payload/autopilot-cockpit-firewall.sh"
	"$trusted_payload/autopilot-cockpit-firewall.service"
)

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
	[ "$count" -eq 8 ] && [ -n "${seen[$trusted_worker]:-}" ] && [ -n "${seen[$service]:-}" ] && [ -n "${seen[$timer]:-}" ]
}

snapshot_from_sha() {
	local checkout="$1" sha="$2" uid gid stage path out mode
	[ -e "$checkout/.git" ] && [ ! -L "$checkout/.git" ] && [ ! -L "$checkout" ] || return 1
	checkout="$(readlink -f -- "$checkout")"
	if [ -z "$test_root" ]; then [[ "$checkout" =~ ^/home/radek/[A-Za-z0-9._/-]+$ ]] || return 1; else [[ "$checkout" =~ ^/tmp/[A-Za-z0-9._/-]+$ ]] || return 1; fi
	[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 1
	uid="$(stat -c %u -- "$checkout")"; gid="$(stat -c %g -- "$checkout")"
	[ "$uid" -ne 0 ] || return 1
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
		mode=644; case "$path" in *.sh) mode=755 ;; esac
		chmod "$mode" "$out"; chown "$expected_uid:$expected_gid" "$out"
		printf '%s %s %s\n' "$(sha256sum -- "$out" | awk '{print $1}')" "$mode" "$path" >> "$stage/manifest"
	done
	chmod 0600 "$stage/manifest"; chown "$expected_uid:$expected_gid" "$stage/manifest"
	printf '%s\n' "$stage"
}

install_snapshot() {
	local stage="$1" backup item source destination mode hash tmp old_enabled old_active payload_dir_existed=0 failed=0
	backup="$(mktemp -d "$test_root/var/lib/autopilot-cockpit/.trusted-backup.XXXXXXXX")"
	chmod 0700 "$backup"; chown "$expected_uid:$expected_gid" "$backup"
	old_enabled="$(systemctl is-enabled "$timer_unit" 2>/dev/null || :)"; [ -n "$old_enabled" ] || old_enabled=disabled
	old_active="$(systemctl is-active "$timer_unit" 2>/dev/null || :)"; [ -n "$old_active" ] || old_active=inactive
	case "$old_enabled" in enabled|disabled|masked|masked-runtime) ;; *) rm -rf "$backup"; return 1 ;; esac
	case "$old_active" in active|inactive|failed) ;; *) rm -rf "$backup"; return 1 ;; esac
	for item in "${managed_paths[@]}"; do
		if [ -e "$item" ] || [ -L "$item" ]; then
			verify_installed_payload || { printf '%s\n' "refusing foreign installed watchdog payload" >&2; rm -rf "$backup"; return 1; }
			cp -a -- "$item" "$backup/$(basename "$item")"
		else : > "$backup/.absent-$(basename "$item")"; fi
	done
	[ -e "$manifest" ] && cp -a -- "$manifest" "$backup/manifest" || : > "$backup/.absent-manifest"
	if [ -e "$trusted_payload" ] || [ -L "$trusted_payload" ]; then
		[ -d "$trusted_payload" ] && [ ! -L "$trusted_payload" ] && [ "$(stat -c %u:%g:%a -- "$trusted_payload")" = "$expected_uid:$expected_gid:755" ] || { rm -rf "$backup"; return 1; }
		payload_dir_existed=1
	fi
	install -d -o "$expected_uid" -g "$expected_gid" -m 0755 "$trusted_payload"
	while IFS=' ' read -r hash mode item; do
		source="$stage/${item##*/}"
		case "$item" in
			ops/cockpit-proxy/live-cutover.sh) destination="$trusted_worker" ;;
			ops/cockpit-proxy/autopilot-cockpit-cutover-recovery.service) destination="$service" ;;
			ops/cockpit-proxy/autopilot-cockpit-cutover-recovery.timer) destination="$timer" ;;
			*) destination="$trusted_payload/${item##*/}" ;;
		esac
		tmp="$(mktemp -- "$(dirname "$destination")/.autopilot-watchdog.XXXXXXXX")" || { failed=1; break; }
		if ! install -o "$expected_uid" -g "$expected_gid" -m "$mode" "$source" "$tmp" || ! mv -T -- "$tmp" "$destination"; then rm -f -- "$tmp"; failed=1; break; fi
	done < "$stage/manifest"
	if [ "$failed" = 0 ]; then
		awk -v worker="$trusted_worker" -v payload="$trusted_payload" -v service="$service" -v timer="$timer" '
		{p=$3; sub(/^.*\//,"",p); if($3~/live-cutover/)p=worker; else if($3~/recovery.service/)p=service; else if($3~/recovery.timer/)p=timer; else p=payload "/" p; print $1,$2,p}' "$stage/manifest" > "$stage/installed-manifest"
		install -o "$expected_uid" -g "$expected_gid" -m 0600 "$stage/installed-manifest" "$manifest" || failed=1
	fi
	[ "$failed" = 0 ] && systemctl daemon-reload || failed=1
	[ "$failed" = 0 ] && systemctl enable "$timer_unit" >/dev/null || failed=1
	[ "$failed" = 0 ] && systemctl start "$timer_unit" || failed=1
	[ "$failed" = 0 ] && [ "$(systemctl is-enabled "$timer_unit")" = enabled ] || failed=1
	[ "$failed" = 0 ] && [ "$(systemctl is-active "$timer_unit")" = active ] || failed=1
	if [ "$failed" = 0 ] && verify_installed_payload; then rm -rf "$backup"; return 0; fi
	for item in "${managed_paths[@]}"; do
		if [ -e "$backup/$(basename "$item")" ]; then cp -a -- "$backup/$(basename "$item")" "$item"; else rm -f -- "$item"; fi
	done
	[ -e "$backup/manifest" ] && cp -a -- "$backup/manifest" "$manifest" || rm -f -- "$manifest"
	[ "$payload_dir_existed" = 1 ] || rmdir -- "$trusted_payload" 2>/dev/null || :
	systemctl daemon-reload || :
	case "$old_enabled" in enabled) systemctl unmask "$timer_unit" >/dev/null 2>&1 || :; systemctl enable "$timer_unit" >/dev/null || : ;; disabled) systemctl unmask "$timer_unit" >/dev/null 2>&1 || :; systemctl disable "$timer_unit" >/dev/null || : ;; masked) systemctl mask "$timer_unit" >/dev/null || : ;; masked-runtime) systemctl mask --runtime "$timer_unit" >/dev/null || : ;; esac
	case "$old_active" in active) systemctl start "$timer_unit" || : ;; inactive) systemctl stop "$timer_unit" || : ;; failed) systemctl stop "$timer_unit" || :; systemctl reset-failed "$timer_unit" || : ;; esac
	rm -rf "$backup"
	return 1
}

case "${1:-}" in
	--recover|--accept)
		verify_installed_payload
		exec "$trusted_worker" "$@"
		;;
	--install-watchdog)
		[ "$#" -eq 3 ] || exit 64
		stage="$(snapshot_from_sha "$2" "$3")"; trap 'rm -rf -- "${stage:-}"' EXIT
		install_snapshot "$stage"
		printf '%s\n' WATCHDOG_READY
		;;
	*)
		[ "$#" -eq 3 ] || exit 64
		stage="$(snapshot_from_sha "$1" "$3")"; trap 'rm -rf -- "${stage:-}"' EXIT
		install_snapshot "$stage"
		rm -rf -- "$stage"; stage=""; trap - EXIT
		exec "$trusted_worker" "$@"
		;;
esac
