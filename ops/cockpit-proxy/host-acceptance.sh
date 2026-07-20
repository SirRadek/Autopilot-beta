#!/usr/bin/env bash
set -Eeuo pipefail

unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
unset CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR

base_url="${AUTOPILOT_PROXY_BASE_URL:-}"
token_command="${AUTOPILOT_PROXY_TOKEN_COMMAND:-}"
ca_cert="${AUTOPILOT_PROXY_CA_CERT:-}"
case "$base_url" in
	https://autopilot.local) tls_port=443 ;;
	https://autopilot.local:8443) tls_port=8443 ;;
	*) printf '%s\n' "AUTOPILOT_PROXY_BASE_URL must be an approved Autopilot HTTPS origin" >&2; exit 1 ;;
esac
[ -n "$token_command" ] || { printf '%s\n' "AUTOPILOT_PROXY_TOKEN_COMMAND is required" >&2; exit 1; }
[ -n "$ca_cert" ] || { printf '%s\n' "AUTOPILOT_PROXY_CA_CERT is required" >&2; exit 1; }
[[ "$ca_cert" == /* ]] && [ -f "$ca_cert" ] && [ ! -L "$ca_cert" ] || {
	printf '%s\n' "AUTOPILOT_PROXY_CA_CERT must be an absolute regular non-symlink file" >&2
	exit 1
}

test_mode="${AUTOPILOT_PROXY_TEST_MODE:-0}"
case "$test_mode" in
	0|1) ;;
	*) exit 1 ;;
esac
certutil_bin=/usr/bin/certutil
if [ "$test_mode" = 1 ]; then
	certutil_bin="${AUTOPILOT_PROXY_TEST_CERTUTIL_BIN:-$certutil_bin}"
fi
[[ "$certutil_bin" == /* ]] && [ -f "$certutil_bin" ] && [ ! -L "$certutil_bin" ] && [ -x "$certutil_bin" ] || {
	printf '%s\n' "certutil must be an absolute executable regular non-symlink file" >&2
	exit 1
}
playwright_browsers_path="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
[[ "$playwright_browsers_path" == /* ]] && [ -d "$playwright_browsers_path" ] && [ ! -L "$playwright_browsers_path" ] || {
	printf '%s\n' "PLAYWRIGHT_BROWSERS_PATH must be an absolute regular directory" >&2
	exit 1
}
openssl_timeout=5s
openssl_kill_after=2s
token_timeout=30s
token_kill_after=5s
playwright_timeout=120s
playwright_kill_after=10s
if [ "$test_mode" = 1 ]; then
	token_timeout="${AUTOPILOT_PROXY_TEST_TOKEN_TIMEOUT:-$token_timeout}"
	token_kill_after="${AUTOPILOT_PROXY_TEST_TOKEN_KILL_AFTER:-$token_kill_after}"
	playwright_timeout="${AUTOPILOT_PROXY_TEST_PLAYWRIGHT_TIMEOUT:-$playwright_timeout}"
	playwright_kill_after="${AUTOPILOT_PROXY_TEST_PLAYWRIGHT_KILL_AFTER:-$playwright_kill_after}"
fi
for duration in "$openssl_timeout" "$openssl_kill_after" "$token_timeout" "$token_kill_after" "$playwright_timeout" "$playwright_kill_after"; do
	[[ "$duration" =~ ^[1-9][0-9]*s$ ]] || exit 1
done

work="$(mktemp -d)"
cleanup() {
	local status=$?
	trap - EXIT INT TERM
	set +e
	unset token TOKEN_TO_ENCODE
	rm -rf -- "$work"
	exit "$status"
}
trap cleanup EXIT INT TERM
umask 077
cookie_jar="$work/cookie.jar"
: > "$cookie_jar"
chmod 600 "$cookie_jar"

timeout --signal=TERM --kill-after="$openssl_kill_after" "$openssl_timeout" openssl s_client -connect "autopilot.local:$tls_port" -servername autopilot.local \
	-verify_return_error -CAfile "$ca_cert" </dev/null 2>/dev/null \
	| timeout --signal=TERM --kill-after="$openssl_kill_after" "$openssl_timeout" openssl x509 -noout -checkhost autopilot.local >/dev/null

request() {
	local name="$1"
	local method="$2"
	local url="$3"
	shift 3
	curl --disable --noproxy '*' --silent --show-error \
		--connect-timeout 2 --max-time 5 \
		--request "$method" \
		--dump-header "$work/$name.headers" \
		--output "$work/$name.body" \
		--write-out '%{http_code}' \
		"$@" "$url"
}
require_header_exact() {
	local expected="$2: $3"
	tr -d '\r' < "$1" | grep -Fxiq -- "$expected" || {
		printf 'missing exact required response header: %s\n' "$2" >&2
		exit 1
	}
}

require_status() {
	[ "$1" = "$2" ] || { printf 'unexpected HTTP status for %s\n' "$3" >&2; exit 1; }
}
require_header() {
	grep -Eiq "^$2:[[:space:]]*$3([[:space:]]|\r)*$" "$1" || {
		printf 'missing required response header: %s\n' "$2" >&2
		exit 1
	}
}

status="$(request root GET "$base_url/")"
require_status "$status" 200 root
require_header_exact "$work/root.headers" Content-Security-Policy "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
require_header "$work/root.headers" X-Content-Type-Options "nosniff"
require_header "$work/root.headers" Referrer-Policy "no-referrer"
require_header "$work/root.headers" Strict-Transport-Security "max-age=300"
require_header "$work/root.headers" Cache-Control "no-cache"

asset_path="$(sed -n 's/.*src="\([^"?]*\/assets\/[^"?]*\)".*/\1/p' "$work/root.body" | head -n 1)"
[ -n "$asset_path" ] || { printf '%s\n' "Cockpit entry document has no immutable asset" >&2; exit 1; }
status="$(request asset GET "$base_url$asset_path")"
require_status "$status" 200 asset
require_header "$work/asset.headers" Cache-Control "public, max-age=31536000, immutable"

status="$(request spa GET "$base_url/proxy-acceptance-route")"
require_status "$status" 200 spa
cmp -s "$work/root.body" "$work/spa.body"
require_header "$work/spa.headers" Cache-Control "no-cache"

status="$(request unauthenticated-api GET "$base_url/auth/session")"
require_status "$status" 401 unauthenticated-api
require_header "$work/unauthenticated-api.headers" Cache-Control "no-store"

for lookalike in authentic statusx sessionsx approvalsx workersx providersx projectsx runsx incidentsx observabilityx; do
	status="$(request "lookalike-$lookalike" GET "$base_url/$lookalike")"
	require_status "$status" 200 "$lookalike"
	cmp -s "$work/root.body" "$work/lookalike-$lookalike.body"
	require_header "$work/lookalike-$lookalike.headers" Cache-Control "no-cache"
done
status="$(request unsupported POST "$base_url/authentic")"
case "$status" in
	404|405) ;;
	*) printf 'unexpected HTTP status for unsupported: %s\n' "$status" >&2; exit 1 ;;
esac
require_header "$work/unsupported.headers" Cache-Control "no-cache"
if grep -Eiq '^content-type:[[:space:]]*application/json([[:space:]]*;|[[:space:]]|\r)*$' "$work/unsupported.headers"; then
	printf '%s\n' "unsupported static lookalike returned API-shaped content" >&2
	exit 1
fi

token_stdout="$work/token-command.stdout"
: > "$token_stdout"
chmod 600 "$token_stdout"
timeout --signal=TERM --kill-after="$token_kill_after" "$token_timeout" bash -c "$token_command" >"$token_stdout" 2>"$work/token-command.stderr" || {
	printf '%s\n' "token command failed or timed out" >&2
	exit 1
}
TOKEN_STDOUT_PATH="$token_stdout" node -e '
const fs = require("node:fs");
const value = fs.readFileSync(process.env.TOKEN_STDOUT_PATH);
if (value.length === 0) process.exit(1);
const body = value.at(-1) === 0x0a ? value.subarray(0, -1) : value;
if (body.length === 0 || body.includes(0x0a) || body.includes(0x0d) || body.includes(0x00)) process.exit(1);
' || {
	printf '%s\n' "token command must return exactly one non-empty line" >&2
	exit 1
}
IFS= read -r token < "$token_stdout" || [ -n "$token" ]
TOKEN_TO_ENCODE="$token" node -e \
	'process.stdout.write(JSON.stringify({token: process.env.TOKEN_TO_ENCODE}))' > "$work/login.json"
status="$(request login POST "$base_url/auth/login" \
	--header 'content-type: application/json' \
	--data-binary "@$work/login.json" \
	--cookie-jar "$cookie_jar")"
rm -f "$work/login.json"
require_status "$status" 200 login
session_cookie_occurrences="$(grep -Eio 'autopilot_session=' "$work/login.headers" | wc -l)"
mapfile -t session_cookie_lines < <(grep -Ei '^set-cookie:[[:space:]]*autopilot_session=' "$work/login.headers" || true)
[ "$session_cookie_occurrences" -eq 1 ] && [ "${#session_cookie_lines[@]}" -eq 1 ] || {
	printf '%s\n' "expected exactly one autopilot_session Set-Cookie header" >&2
	exit 1
}
session_cookie_line="${session_cookie_lines[0]%$'\r'}"
[[ "$session_cookie_line" != *,* ]] || {
	printf '%s\n' "comma-joined session cookies are forbidden" >&2
	exit 1
}
IFS=';' read -r -a session_cookie_fields <<< "${session_cookie_line#*:}"
session_cookie_pair="${session_cookie_fields[0]}"
session_cookie_pair="${session_cookie_pair#${session_cookie_pair%%[![:space:]]*}}"
session_cookie_pair="${session_cookie_pair%${session_cookie_pair##*[![:space:]]}}"
[[ "$session_cookie_pair" =~ ^[Aa][Uu][Tt][Oo][Pp][Ii][Ll][Oo][Tt]_[Ss][Ee][Ss][Ss][Ii][Oo][Nn]=[A-Za-z0-9_-]{43}$ ]] || {
	printf '%s\n' "invalid autopilot_session cookie value" >&2
	exit 1
}
secure_count=0
httponly_count=0
samesite_lax_count=0
for session_cookie_attribute in "${session_cookie_fields[@]:1}"; do
	session_cookie_attribute="${session_cookie_attribute#${session_cookie_attribute%%[![:space:]]*}}"
	session_cookie_attribute="${session_cookie_attribute%${session_cookie_attribute##*[![:space:]]}}"
	case "${session_cookie_attribute,,}" in
		secure) secure_count=$((secure_count + 1)) ;;
		httponly) httponly_count=$((httponly_count + 1)) ;;
		samesite=lax) samesite_lax_count=$((samesite_lax_count + 1)) ;;
	esac
done
[ "$secure_count" -eq 1 ] && [ "$httponly_count" -eq 1 ] && [ "$samesite_lax_count" -eq 1 ] || {
	printf '%s\n' "session cookie security attributes are invalid" >&2
	exit 1
}

status="$(request session GET "$base_url/auth/session" --cookie "$cookie_jar")"
require_status "$status" 200 session
status="$(request status GET "$base_url/status" --cookie "$cookie_jar")"
require_status "$status" 200 status
require_header "$work/status.headers" Cache-Control "no-store"
for api_path in sessions approvals workers providers/quotas projects runs incidents observability/summary; do
	name="api-${api_path//\//-}"
	status="$(request "$name" GET "$base_url/$api_path" --cookie "$cookie_jar")"
	require_status "$status" 200 "$api_path"
	require_header "$work/$name.headers" Cache-Control "no-store"
done
status="$(request evil-origin POST "$base_url/auth/logout" \
	--cookie "$cookie_jar" --header 'Origin: https://evil.example')"
require_status "$status" 403 evil-origin
status="$(request evil-referer POST "$base_url/auth/logout" \
	--cookie "$cookie_jar" --header 'Referer: https://evil.example/hostile')"
require_status "$status" 403 evil-referer
status="$(request logout POST "$base_url/auth/logout" \
	--cookie "$cookie_jar" --header "Origin: $base_url")"
require_status "$status" 200 logout
status="$(request logged-out GET "$base_url/auth/session" --cookie "$cookie_jar")"
require_status "$status" 401 logged-out

browser_home="$work/browser-home"
nss_db="$browser_home/.local/share/pki/nssdb"
install -d -m 0700 "$nss_db"
HOME="$browser_home" timeout --signal=TERM --kill-after="$openssl_kill_after" "$openssl_timeout" bash -c '
	set -Eeuo pipefail
	"$1" -d "sql:$2" -N --empty-password
	"$1" -d "sql:$2" -A -t "C,," -n autopilot-caddy-root -i "$3"
	"$1" -d "sql:$2" -L -n autopilot-caddy-root >/dev/null
' _ "$certutil_bin" "$nss_db" "$ca_cert"

HOME="$browser_home" PLAYWRIGHT_BROWSERS_PATH="$playwright_browsers_path" AUTOPILOT_PROXY_TEST_TOKEN="$token" \
	timeout --signal=TERM --kill-after="$playwright_kill_after" "$playwright_timeout" npx --no-install playwright test --config playwright.proxy.config.ts --output "$work/playwright-results"
unset token TOKEN_TO_ENCODE

printf '%s\n' "HOST_PROXY_ACCEPTANCE_OK"
