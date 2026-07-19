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
ownership_nonce=""
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
	local -a ledger_lines
	[ -d "$isolated_runtime" ] && [ ! -L "$isolated_runtime" ] || return 1
	[ "$(stat -c %u:%g:%a -- "$isolated_runtime")" = "$expected_runtime_uid:$expected_runtime_gid:755" ] || return 1
	[ -f "$marker" ] && [ ! -L "$marker" ] || return 1
	[ "$(stat -c %u:%g:%a -- "$marker")" = "$expected_runtime_uid:$expected_runtime_gid:600" ] || return 1
	mapfile -t ledger_lines < "$marker"
	[ "${#ledger_lines[@]}" -eq 2 ] || return 1
	[ "${ledger_lines[0]}" = "version=autopilot-cockpit-isolated-v2" ] || return 1
	[[ "${ledger_lines[1]}" =~ ^nonce=([a-f0-9]{64})$ ]] || return 1
	ownership_nonce="${BASH_REMATCH[1]}"
}

unit_load_state() {
	systemctl show --property=LoadState --value "$1" 2>/dev/null
}

unit_identity_matches() {
	local description
	description="$(systemctl show --property=Description --value "$1" 2>/dev/null)" || return 2
	[ "$description" = "Autopilot isolated $ownership_nonce" ]
}

unit_active_identity_matches() {
	local load_state active_state
	load_state="$(unit_load_state "$1")" || return 2
	[ "$load_state" = "loaded" ] || return 1
	active_state="$(systemctl show --property=ActiveState --value "$1" 2>/dev/null)" || return 2
	[ "$active_state" = "active" ] || return 1
	unit_identity_matches "$1"
}

socket_absent() {
	local output
	output="$(ss -H -ltn "sport = :$1")" || return 2
	[ -z "$output" ]
}

socket_inspection_succeeds() {
	ss -H -ltn "sport = :$1" >/dev/null
}

nft_table_presence() {
	local tables
	tables="$(nft -j list tables)" || return 2
	NFT_TABLES_JSON="$tables" NFT_TABLE_NAME="$table_name" node -e '
const data = JSON.parse(process.env.NFT_TABLES_JSON);
const matches = (data.nftables ?? []).filter((entry) => entry.table?.family === "inet" && entry.table?.name === process.env.NFT_TABLE_NAME);
if (matches.length > 1) process.exit(2);
process.stdout.write(matches.length === 1 ? "present" : "absent");
' || return 2
}

nft_identity_matches() {
	local table_json
	table_json="$(nft -j list table inet "$table_name")" || return 2
	NFT_TABLE_JSON="$table_json" NFT_TABLE_NAME="$table_name" NFT_NONCE="$ownership_nonce" node -e '
const data = JSON.parse(process.env.NFT_TABLE_JSON);
const expected = `autopilot-isolated:${process.env.NFT_NONCE}`;
const entries = data.nftables ?? [];
const table = entries.filter((e) => e.table?.family === "inet" && e.table?.name === process.env.NFT_TABLE_NAME);
const chain = entries.filter((e) => e.chain?.family === "inet" && e.chain?.table === process.env.NFT_TABLE_NAME && e.chain?.name === "input");
const rule = entries.filter((e) => e.rule?.family === "inet" && e.rule?.table === process.env.NFT_TABLE_NAME && e.rule?.chain === "input");
if (table.length !== 1 || chain.length !== 1 || rule.length !== 1) process.exit(1);
const expectedExpr = [
  { match: { op: "!=", left: { meta: { key: "iifname" } }, right: "lo" } },
  { match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: 8443 } },
  { match: { op: "!=", left: { payload: { protocol: "ip", field: "saddr" } }, right: "192.168.122.1" } },
  { drop: null },
];
const c = chain[0].chain;
const r = rule[0].rule;
if (table[0].table.comment !== expected || c.comment !== expected || r.comment !== expected) process.exit(1);
if (c.type !== "filter" || c.hook !== "input" || c.prio !== -10 || c.policy !== "accept") process.exit(1);
if (JSON.stringify(r.expr) !== JSON.stringify(expectedExpr)) process.exit(1);
'
}

isolated_resources_identity_valid() {
	local presence
	unit_active_identity_matches "$unit_control_plane" || return $?
	unit_active_identity_matches "$unit_proxy" || return $?
	presence="$(nft_table_presence)" || return 2
	[ "$presence" = "present" ] || return 1
	nft_identity_matches
}

isolated_resources_absent() {
	local state presence
	socket_absent 8443 || return $?
	socket_absent 8877 || return $?
	state="$(unit_load_state "$unit_proxy")" || return 2
	[ "$state" = "not-found" ] || return 1
	state="$(unit_load_state "$unit_control_plane")" || return 2
	[ "$state" = "not-found" ] || return 1
	presence="$(nft_table_presence)" || return 2
	[ "$presence" = "absent" ]
}

perform_cleanup() {
	local status="$1"
	local cleanup_status=0
	local proxy_state control_state presence
	set +e
	[ "$cleanup_authorized" = 1 ] || return "$status"
	socket_inspection_succeeds 8443 || cleanup_status=1
	socket_inspection_succeeds 8877 || cleanup_status=1
	proxy_state="$(unit_load_state "$unit_proxy")" || cleanup_status=1
	control_state="$(unit_load_state "$unit_control_plane")" || cleanup_status=1
	presence="$(nft_table_presence)" || cleanup_status=1
	if [ "$cleanup_status" -eq 0 ]; then
		[ "$proxy_state" = "not-found" ] || unit_identity_matches "$unit_proxy" || cleanup_status=1
		[ "$control_state" = "not-found" ] || unit_identity_matches "$unit_control_plane" || cleanup_status=1
		[ "$presence" = "absent" ] || nft_identity_matches || cleanup_status=1
	fi
	if [ "$cleanup_status" -eq 0 ]; then
		[ "$proxy_state" = "not-found" ] || { unit_identity_matches "$unit_proxy" && systemctl stop "$unit_proxy" >/dev/null 2>&1; } || cleanup_status=1
		[ "$control_state" = "not-found" ] || { unit_identity_matches "$unit_control_plane" && systemctl stop "$unit_control_plane" >/dev/null 2>&1; } || cleanup_status=1
		[ "$presence" = "absent" ] || { nft_identity_matches && nft delete table inet "$table_name" >/dev/null 2>&1; } || cleanup_status=1
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
	<(cd "$candidate/cockpit/dist" && \
		find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)
cmp -s "$manifest" \
	<(cd "$release" && find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)
(
	cd "$release"
	sha256sum --check --strict "$manifest" >/dev/null
)

for port in 8443 8877; do
	if ! socket_absent "$port"; then
		printf '%s\n' "isolated port $port is already occupied" >&2
		exit 1
	fi
done
for unit in "$unit_proxy" "$unit_control_plane"; do
	load_state="$(unit_load_state "$unit")" || exit 1
	if [ "$load_state" != "not-found" ]; then
		printf 'isolated transient unit already exists: %s\n' "$unit" >&2
		exit 1
	fi
done
nft_presence="$(nft_table_presence)" || exit 1
if [ "$nft_presence" = "present" ]; then
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
ownership_nonce="$(timeout --signal=TERM --kill-after=2s 5s openssl rand -hex 32)"
[[ "$ownership_nonce" =~ ^[a-f0-9]{64}$ ]]
(
	umask 077
	printf '%s\n' "version=autopilot-cockpit-isolated-v2" "nonce=$ownership_nonce" > "$isolated_runtime/.autopilot-cockpit-isolated-owned"
)
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
	auto_https disable_redirects
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
if [ "$test_mode" = 1 ]; then
	setpriv --reuid "$caddy_uid" --regid "$caddy_gid" --clear-groups -- \
		env XDG_DATA_HOME="$isolated_runtime/caddy-data" XDG_CONFIG_HOME="$isolated_runtime/caddy-config" \
		caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null
else
	/usr/bin/setpriv --reuid "$caddy_uid" --regid "$caddy_gid" --clear-groups -- \
		/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
		XDG_DATA_HOME="$isolated_runtime/caddy-data" XDG_CONFIG_HOME="$isolated_runtime/caddy-config" \
		/usr/bin/caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null
fi

nft_identity="autopilot-isolated:$ownership_nonce"
nft -f - <<EOF
add table inet $table_name { comment "$nft_identity"; }
add chain inet $table_name input { type filter hook input priority -10; policy accept; comment "$nft_identity"; }
add rule inet $table_name input iifname != "lo" tcp dport 8443 ip saddr != 192.168.122.1 drop comment "$nft_identity"
EOF
nft_created=1

systemd-run \
	--unit=autopilot-cockpit-isolated-control-plane \
	--uid="$candidate_uid" \
	--property="WorkingDirectory=$candidate" \
	--property="EnvironmentFile=$environment_file" \
	--property="Description=Autopilot isolated $ownership_nonce" \
	--property=NoNewPrivileges=yes \
	--collect \
	/usr/bin/npm --prefix "$candidate" run control-plane:serve -- "$isolated_runtime/state" 8877 >/dev/null
control_plane_started=1

systemd-run \
	--unit=autopilot-cockpit-isolated-proxy \
	--uid="$caddy_uid" \
	--setenv="XDG_DATA_HOME=$isolated_runtime/caddy-data" \
	--setenv="XDG_CONFIG_HOME=$isolated_runtime/caddy-config" \
	--property="Description=Autopilot isolated $ownership_nonce" \
	--property=NoNewPrivileges=yes \
	--collect \
	caddy run --config "$caddyfile" --adapter caddyfile >/dev/null
proxy_started=1
isolated_resources_identity_valid

retry_delay=1
[ "$test_mode" = 0 ] || retry_delay=0
healthy=0
health_body="$isolated_runtime/health.json"
for _ in $(seq 1 12); do
	health_status="$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 5 \
		--output "$health_body" --write-out '%{http_code}' "http://127.0.0.1:8877/health" || true)"
	if [ "$health_status" = 200 ] && HEALTH_JSON_PATH="$health_body" node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.env.HEALTH_JSON_PATH, "utf8"));
if (body?.ok !== true || Object.keys(body).length !== 1) process.exit(1);
'; then
		healthy=1
		break
	fi
	sleep "$retry_delay"
done
[ "$healthy" = 1 ]

ready=0
ready_body="$isolated_runtime/ready.json"
for _ in $(seq 1 12); do
	ready_status="$(curl --disable --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 5 \
		--output "$ready_body" --write-out '%{http_code}' "http://127.0.0.1:8877/ready" || true)"
	if [ "$ready_status" = 200 ] && READY_JSON_PATH="$ready_body" node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.env.READY_JSON_PATH, "utf8"));
if (body?.ready !== true) process.exit(1);
for (const name of ["configuration", "managed_state", "project_registry", "supervisor", "token_gateway"])
  if (body?.components?.[name]?.status !== "ready" || body.components[name].error_code !== null) process.exit(1);
'; then
		ready=1
		break
	fi
	sleep "$retry_delay"
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
timeout --signal=TERM --kill-after=2s 5s openssl x509 -in "$private_root" -out "$public_root_tmp"
chmod 0644 "$public_root_tmp"
mv -f -- "$public_root_tmp" "$public_root"
proxy_ready=0
for _ in $(seq 1 30); do
	if curl --disable --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 5 --cacert "$public_root" \
		--resolve "autopilot.local:8443:192.168.122.99" \
		"https://autopilot.local:8443/" >/dev/null; then
		proxy_ready=1
		break
	fi
	sleep 1
done
[ "$proxy_ready" = 1 ]

fingerprint="$(timeout --signal=TERM --kill-after=2s 5s openssl x509 -in "$public_root" -noout -fingerprint -sha256)"
fingerprint="${fingerprint#*=}"
[ -n "$fingerprint" ]

isolated_resources_identity_valid
trap - EXIT INT TERM
printf 'PUBLIC_CA_PATH=%s\n' "$public_root"
printf 'PUBLIC_CA_SHA256_FINGERPRINT=%s\n' "$fingerprint"
printf '%s\n' "ISOLATED_ACCEPTANCE_READY"
