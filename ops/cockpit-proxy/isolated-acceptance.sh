#!/usr/bin/env bash
set -Eeuo pipefail

unit_proxy="autopilot-cockpit-isolated-proxy.service"
unit_control_plane="autopilot-cockpit-isolated-control-plane.service"
table_name="autopilot_cockpit_isolated"
default_runtime="/tmp/autopilot-cockpit-proxy-state"
isolated_runtime="${3:-$default_runtime}"
cleanup_authorized=0
nft_created=0
control_plane_started=0
proxy_started=0
runtime_created=0
test_mode="${AUTOPILOT_PROXY_TEST_MODE:-0}"
case "$test_mode" in 0|1) ;; *) exit 1 ;; esac
expected_runtime_uid=0
expected_runtime_gid=0
if [ "$test_mode" = 1 ]; then
	expected_runtime_uid="$(id -u)"
	expected_runtime_gid="$(id -g)"
fi

resolve_safe_runtime_path() {
	local input="$1" parent_input parent_lexical parent_resolved parent_mode parent_mode_value
	parent_input="$(dirname -- "$input")"
	parent_lexical="$(realpath -ms -- "$parent_input")"
	parent_resolved="$(realpath -e -- "$parent_input")"
	[ "$parent_lexical" = "$parent_resolved" ] || {
		printf '%s\n' "isolated runtime parent must not contain symlinks" >&2
		return 1
	}
	[ "$(stat -c %u:%g -- "$parent_resolved")" = "$expected_runtime_uid:$expected_runtime_gid" ] || {
		printf '%s\n' "isolated runtime parent has unsafe ownership" >&2
		return 1
	}
	parent_mode="$(stat -c %a -- "$parent_resolved")"
	parent_mode_value=$((8#$parent_mode))
	if (( (parent_mode_value & 0022) != 0 && (parent_mode_value & 01000) == 0 )); then
		printf '%s\n' "isolated runtime parent is writable without sticky protection" >&2
		return 1
	fi
	printf '%s/%s\n' "$parent_resolved" "$(basename -- "$input")"
}

runtime_evidence_valid() {
	local marker="$isolated_runtime/.autopilot-cockpit-isolated-owned"
	[ -d "$isolated_runtime" ] && [ ! -L "$isolated_runtime" ] || return 1
	[ "$(stat -c %u:%g:%a -- "$isolated_runtime")" = "$expected_runtime_uid:$expected_runtime_gid:755" ] || return 1
	[ -f "$marker" ] && [ ! -L "$marker" ] || return 1
	[ "$(stat -c %u:%g:%a -- "$marker")" = "$expected_runtime_uid:$expected_runtime_gid:600" ] || return 1
	[ "$(cat -- "$marker")" = "autopilot-cockpit-isolated-v1" ]
}

unit_absent() {
	[ "$(systemctl show --property=LoadState --value "$1" 2>/dev/null || true)" = "not-found" ]
}

isolated_resources_absent() {
	[ -z "$(ss -H -ltn 'sport = :8443')" ] || return 1
	[ -z "$(ss -H -ltn 'sport = :8877')" ] || return 1
	unit_absent "$unit_proxy" || return 1
	unit_absent "$unit_control_plane" || return 1
	! nft list table inet "$table_name" >/dev/null 2>&1
}

perform_cleanup() {
	local status="$1"
	local cleanup_status=0
	set +e
	[ "$cleanup_authorized" = 1 ] || return "$status"
	if [ "$proxy_started" = 1 ] || ! unit_absent "$unit_proxy"; then
		systemctl stop "$unit_proxy" >/dev/null 2>&1 || cleanup_status=1
	fi
	if [ "$control_plane_started" = 1 ] || ! unit_absent "$unit_control_plane"; then
		systemctl stop "$unit_control_plane" >/dev/null 2>&1 || cleanup_status=1
	fi
	if [ "$nft_created" = 1 ] || nft list table inet "$table_name" >/dev/null 2>&1; then
		nft delete table inet "$table_name" >/dev/null 2>&1 || cleanup_status=1
	fi
	isolated_resources_absent || cleanup_status=1
	if [ "$cleanup_status" -eq 0 ]; then
		if [ "$runtime_created" = 1 ] || runtime_evidence_valid; then
			rm -rf -- "$isolated_runtime" || cleanup_status=1
		else
			cleanup_status=1
		fi
	fi
	if [ "$status" -eq 0 ]; then
		status="$cleanup_status"
	fi
	return "$status"
}

cleanup_on_exit() {
	local status=$?
	trap - EXIT INT TERM
	perform_cleanup "$status"
	exit $?
}

cleanup_on_interrupt() {
	trap - EXIT INT TERM
	perform_cleanup 130
	exit 130
}

cleanup_on_terminate() {
	trap - EXIT INT TERM
	perform_cleanup 143
	exit 143
}

if [ "${1:-}" = "--cleanup" ]; then
	[ "$#" -le 2 ] || exit 1
	[ "$test_mode" = 1 ] || [ "$EUID" -eq 0 ] || exit 1
	isolated_runtime="$(resolve_safe_runtime_path "${2:-$default_runtime}")"
	if [ ! -e "$isolated_runtime" ] && [ ! -L "$isolated_runtime" ]; then
		if isolated_resources_absent; then
			exit 0
		fi
		printf '%s\n' "isolated resources remain without runtime ownership evidence" >&2
		exit 1
	fi
	if ! runtime_evidence_valid; then
		printf '%s\n' "refusing to remove an unowned isolated runtime" >&2
		exit 1
	fi
	cleanup_authorized=1
	perform_cleanup 0
	exit $?
fi

if [ "$#" -ne 3 ]; then
	printf '%s\n' "usage: isolated-acceptance.sh CANDIDATE RELEASE_ROOT ISOLATED_RUNTIME" >&2
	exit 1
fi

candidate="$(realpath -e -- "$1")"
release_root="$(realpath -e -- "$2")"
runtime_input="$3"

if [ "$test_mode" = 0 ] && [ "$EUID" -ne 0 ]; then
	printf '%s\n' "isolated acceptance requires EUID 0" >&2
	exit 1
fi
isolated_runtime="$(resolve_safe_runtime_path "$runtime_input")"
if [ "$test_mode" = 1 ]; then
	case "$isolated_runtime" in /tmp/*) ;; *) exit 1 ;; esac
fi

sha="$(git -C "$candidate" rev-parse HEAD)"
[ -z "$(git -C "$candidate" status --porcelain)" ]
release="$release_root/releases/$sha"
manifest="$release_root/manifests/$sha.sha256"
[ -d "$release" ] && [ ! -L "$release" ] && [ -f "$manifest" ] && [ ! -L "$manifest" ]
expected_uid=0
expected_gid=0
if [ "$test_mode" = 1 ]; then
	expected_uid="$(id -u)"
	expected_gid="$(id -g)"
fi
[ -z "$(find -P "$release" -type d \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0555 \) -print -quit)" ]
[ -z "$(find -P "$release" -type f \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0444 \) -print -quit)" ]
[ "$(stat -c %u:%g:%a -- "$manifest")" = "$expected_uid:$expected_gid:444" ]
[ -z "$(find -P "$release" -mindepth 1 ! -type d ! -type f -print -quit)" ]
cmp -s \
	<(cd "$candidate/cockpit/dist" && find -P . -mindepth 1 -printf '%y %P\0' | LC_ALL=C sort -z) \
	<(cd "$release" && find -P . -mindepth 1 -printf '%y %P\0' | LC_ALL=C sort -z)
cmp -s "$manifest" \
	<(cd "$release" && find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)
(
	cd "$release"
	sha256sum --check --strict "$manifest" >/dev/null
)

for port in 8443 8877; do
	if [ -n "$(ss -H -ltn "sport = :$port")" ]; then
		printf '%s\n' "isolated port $port is already occupied" >&2
		exit 1
	fi
done
for unit in "$unit_proxy" "$unit_control_plane"; do
	load_state="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null || true)"
	if [ "$load_state" != "not-found" ]; then
		printf 'isolated transient unit already exists: %s\n' "$unit" >&2
		exit 1
	fi
done
if nft list table inet "$table_name" >/dev/null 2>&1; then
	printf '%s\n' "isolated nftables table already exists" >&2
	exit 1
fi

trap cleanup_on_exit EXIT
trap cleanup_on_interrupt INT
trap cleanup_on_terminate TERM

candidate_uid="$(stat -c %u -- "$candidate")"
candidate_gid="$(stat -c %g -- "$candidate")"
caddy_uid="$candidate_uid"
caddy_gid="$candidate_gid"
if [ "$test_mode" = 0 ]; then
	caddy_uid="$(id -u caddy)"
	caddy_gid="$(id -g caddy)"
fi

mkdir -m 0755 -- "$isolated_runtime"
[ -d "$isolated_runtime" ] && [ ! -L "$isolated_runtime" ]
[ "$(stat -c %u:%g:%a -- "$isolated_runtime")" = "$expected_runtime_uid:$expected_runtime_gid:755" ]
runtime_created=1
cleanup_authorized=1
printf '%s\n' "autopilot-cockpit-isolated-v1" > "$isolated_runtime/.autopilot-cockpit-isolated-owned"
chmod 0600 "$isolated_runtime/.autopilot-cockpit-isolated-owned"
[ "$(stat -c %u:%g:%a -- "$isolated_runtime/.autopilot-cockpit-isolated-owned")" = "$expected_runtime_uid:$expected_runtime_gid:600" ]
install -d -m 0700 -o "$candidate_uid" -g "$candidate_gid" "$isolated_runtime/state" "$isolated_runtime/projects"
install -d -m 0700 -o "$caddy_uid" -g "$caddy_gid" "$isolated_runtime/caddy-data" "$isolated_runtime/caddy-config"
printf '%s\n' '{"schema_version":"v1","projects":[]}' > "$isolated_runtime/state/projects.json"
chown "$candidate_uid:$candidate_gid" "$isolated_runtime/state/projects.json"
chmod 0600 "$isolated_runtime/state/projects.json"

environment_file="$isolated_runtime/control-plane.env"
(
	umask 077
	printf '%s\n' \
		'CONTROL_PLANE_TOKEN=isolated-test-token' \
		'CONTROL_PLANE_SECURE_COOKIES=true' \
		"AUTOPILOT_PROJECTS_DIR=$isolated_runtime/projects" > "$environment_file"
)
chown "$candidate_uid:$candidate_gid" "$environment_file"
chmod 0600 "$environment_file"

caddyfile="$isolated_runtime/Caddyfile"
cat > "$caddyfile" <<EOF
{
	admin 127.0.0.1:2020
}
https://autopilot.local:8443 {
	bind 192.168.122.99
	tls internal
	root * $release
	header {
		Content-Security-Policy "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		Strict-Transport-Security "max-age=300"
	}
	@api path /auth /auth/* /status /status/* /sessions /sessions/* /approvals /approvals/* /workers /workers/* /providers /providers/* /projects /projects/* /runs /runs/* /incidents /incidents/* /observability /observability/*
	handle @api {
		header Cache-Control "no-store"
		reverse_proxy 127.0.0.1:8877
	}
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@document not path /assets/*
	header @document Cache-Control "no-cache"
	@spa {
		method GET HEAD
		not file
	}
	rewrite @spa /index.html
	file_server
}
EOF
chown "$caddy_uid:$caddy_gid" "$caddyfile"
chmod 0640 "$caddyfile"
XDG_DATA_HOME="$isolated_runtime/caddy-data" XDG_CONFIG_HOME="$isolated_runtime/caddy-config" \
	caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null

nft add table inet "$table_name"
nft_created=1
nft add chain inet "$table_name" input '{ type filter hook input priority -10; policy accept; }'
nft add rule inet "$table_name" input tcp dport 8443 ip saddr != 192.168.122.1 drop

systemd-run \
	--unit=autopilot-cockpit-isolated-control-plane \
	--uid="$candidate_uid" \
	--property="WorkingDirectory=$candidate" \
	--property="EnvironmentFile=$environment_file" \
	--property=NoNewPrivileges=yes \
	--collect \
	/usr/bin/npm --prefix "$candidate" run control-plane:serve -- "$isolated_runtime/state" 8877 >/dev/null
control_plane_started=1

systemd-run \
	--unit=autopilot-cockpit-isolated-proxy \
	--uid="$caddy_uid" \
	--setenv="XDG_DATA_HOME=$isolated_runtime/caddy-data" \
	--setenv="XDG_CONFIG_HOME=$isolated_runtime/caddy-config" \
	--property=NoNewPrivileges=yes \
	--collect \
	caddy run --config "$caddyfile" --adapter caddyfile >/dev/null
proxy_started=1

ready=0
for _ in $(seq 1 30); do
	if curl --disable --noproxy '*' --fail --silent --show-error "http://127.0.0.1:8877/health" >/dev/null; then
		ready=1
		break
	fi
	sleep 1
done
[ "$ready" = 1 ]

private_root="$isolated_runtime/caddy-data/caddy/pki/authorities/local/root.crt"
for _ in $(seq 1 30); do
	[ -f "$private_root" ] && break
	sleep 1
done
[ -f "$private_root" ]
[ ! -L "$private_root" ]
public_root="$isolated_runtime/autopilot-caddy-root.crt"
if ! LC_ALL=C awk '
	BEGIN { state = 0; objects = 0; body = 0 }
	state == 0 && /^[[:space:]]*$/ { next }
	state == 0 && $0 == "-----BEGIN CERTIFICATE-----" { state = 1; objects++; next }
	state == 1 && $0 == "-----END CERTIFICATE-----" { if (!body) exit 1; state = 2; next }
	state == 1 && /^[A-Za-z0-9+\/=]+$/ { body = 1; next }
	state == 2 && /^[[:space:]]*$/ { next }
	{ exit 1 }
	END { if (state != 2 || objects != 1) exit 1 }
' "$private_root"; then
	printf '%s\n' "refusing non-certificate data in CA export source" >&2
	exit 1
fi
public_root_tmp="$isolated_runtime/.autopilot-caddy-root.crt.tmp"
openssl x509 -in "$private_root" -out "$public_root_tmp"
chmod 0644 "$public_root_tmp"
mv -f -- "$public_root_tmp" "$public_root"
proxy_ready=0
for _ in $(seq 1 30); do
	if curl --disable --noproxy '*' --fail --silent --show-error --cacert "$public_root" \
		--resolve "autopilot.local:8443:192.168.122.99" \
		"https://autopilot.local:8443/" >/dev/null; then
		proxy_ready=1
		break
	fi
	sleep 1
done
[ "$proxy_ready" = 1 ]

fingerprint="$(openssl x509 -in "$public_root" -noout -fingerprint -sha256)"
fingerprint="${fingerprint#*=}"
[ -n "$fingerprint" ]

trap - EXIT INT TERM
printf 'PUBLIC_CA_PATH=%s\n' "$public_root"
printf 'PUBLIC_CA_SHA256_FINGERPRINT=%s\n' "$fingerprint"
printf '%s\n' "ISOLATED_ACCEPTANCE_READY"
