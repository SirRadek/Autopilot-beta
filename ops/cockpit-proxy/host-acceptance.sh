#!/usr/bin/env bash
set -Eeuo pipefail

unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
unset CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR

base_url="${AUTOPILOT_PROXY_BASE_URL:-}"
token_command="${AUTOPILOT_PROXY_TOKEN_COMMAND:-}"
case "$base_url" in
	https://autopilot.local) tls_port=443 ;;
	https://autopilot.local:8443) tls_port=8443 ;;
	*) printf '%s\n' "AUTOPILOT_PROXY_BASE_URL must be an approved Autopilot HTTPS origin" >&2; exit 1 ;;
esac
[ -n "$token_command" ] || { printf '%s\n' "AUTOPILOT_PROXY_TOKEN_COMMAND is required" >&2; exit 1; }

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

timeout 5s openssl s_client -connect "autopilot.local:$tls_port" -servername autopilot.local \
	-verify_return_error </dev/null 2>/dev/null \
	| timeout 5s openssl x509 -noout -checkhost autopilot.local >/dev/null

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
require_status "$status" 405 unsupported
require_header "$work/unsupported.headers" Cache-Control "no-cache"
if grep -Eiq '^content-type:[[:space:]]*application/json([[:space:]]*;|[[:space:]]|\r)*$' "$work/unsupported.headers"; then
	printf '%s\n' "unsupported static lookalike returned API-shaped content" >&2
	exit 1
fi

token="$(bash -c "$token_command" 2>"$work/token-command.stderr")"
[ -n "$token" ] && [[ "$token" != *$'\n'* ]] || {
	printf '%s\n' "token command must return exactly one non-empty line" >&2
	exit 1
}
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

AUTOPILOT_PROXY_TEST_TOKEN="$token" npx playwright test --config playwright.proxy.config.ts
unset token TOKEN_TO_ENCODE

printf '%s\n' "HOST_PROXY_ACCEPTANCE_OK"
