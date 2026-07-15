#!/usr/bin/env bash
set -Eeuo pipefail

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$EUID" -eq 0 ] || { printf '%s\n' "watchdog installation requires EUID 0" >&2; exit 1; }
[ "$#" -eq 0 ] || exit 1

source_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
program_source="$source_dir/live-cutover.sh"
service_source="$source_dir/autopilot-cockpit-cutover-recovery.service"
timer_source="$source_dir/autopilot-cockpit-cutover-recovery.timer"
program=/usr/local/libexec/autopilot-cockpit-live-cutover
service=/etc/systemd/system/autopilot-cockpit-cutover-recovery.service
timer=/etc/systemd/system/autopilot-cockpit-cutover-recovery.timer

for source in "$program_source" "$service_source" "$timer_source"; do
	[ -f "$source" ] && [ ! -L "$source" ] || exit 1
done
[ -d /usr/local/libexec ] && [ ! -L /usr/local/libexec ]
[ "$(stat -c %u:%g:%a /usr/local/libexec)" = 0:0:755 ]
[ -d /etc/systemd/system ] && [ ! -L /etc/systemd/system ]
[ "$(stat -c %u:%g:%a /etc/systemd/system)" = 0:0:755 ]

umask 077
tmp_program="$(mktemp /usr/local/libexec/.autopilot-cutover-recovery.XXXXXXXXXX)"
tmp_service="$(mktemp /etc/systemd/system/.autopilot-cutover-recovery-service.XXXXXXXXXX)"
tmp_timer="$(mktemp /etc/systemd/system/.autopilot-cutover-recovery-timer.XXXXXXXXXX)"
trap 'rm -f -- "${tmp_program:-}" "${tmp_service:-}" "${tmp_timer:-}"' EXIT
install -o 0 -g 0 -m 0755 "$program_source" "$tmp_program"
install -o 0 -g 0 -m 0644 "$service_source" "$tmp_service"
install -o 0 -g 0 -m 0644 "$timer_source" "$tmp_timer"
mv -T -- "$tmp_program" "$program"; tmp_program=""
mv -T -- "$tmp_service" "$service"; tmp_service=""
mv -T -- "$tmp_timer" "$timer"; tmp_timer=""
systemctl daemon-reload
systemctl enable --now autopilot-cockpit-cutover-recovery.timer
state="$(systemctl is-active autopilot-cockpit-cutover-recovery.timer)"
[ "$state" = active ]
enabled="$(systemctl is-enabled autopilot-cockpit-cutover-recovery.timer)"
[ "$enabled" = enabled ]
trap - EXIT
printf '%s\n' WATCHDOG_READY
