#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
	exit 1
fi

checkout="$(realpath -e -- "$1")"
release_root_input="$2"
production_root="/srv/autopilot-cockpit"
test_mode="${AUTOPILOT_RELEASE_TEST_MODE:-0}"
case "$test_mode" in 0|1) ;; *) exit 1 ;; esac

if [ "$test_mode" = "1" ]; then
	case "$release_root_input" in
		/srv|/srv/*) printf '%s\n' "test mode is forbidden for $production_root" >&2; exit 1 ;;
	esac
fi

if [ "$release_root_input" = "$production_root" ]; then
	if [ "$EUID" -ne 0 ]; then
		printf '%s\n' "production staging requires EUID 0" >&2
		exit 1
	fi
fi

test ! -L "$release_root_input"
release_root="$(realpath -e -- "$release_root_input")"
test "$release_root_input" = "$release_root"
test -d "$release_root"

if [ "$test_mode" = "1" ]; then
	temp_root="$(realpath -e -- "${TMPDIR:-/tmp}")"
	case "$release_root" in
		"$temp_root"/*) ;;
		*) printf '%s\n' "test mode requires a canonical temporary release root" >&2; exit 1 ;;
	esac
	expected_uid="$(id -u)"
	expected_gid="$(id -g)"
else
	test "$release_root" = "$production_root"
	test "$EUID" -eq 0
	expected_uid=0
	expected_gid=0
fi

test "$(stat -c %u -- "$release_root")" -eq "$expected_uid"
test "$(stat -c %g -- "$release_root")" -eq "$expected_gid"
if [ "$test_mode" != "1" ]; then
	test $((8#$(stat -c %a -- "$release_root") & 8#022)) -eq 0
fi

sha="$(git -C "$checkout" rev-parse HEAD)"
test -z "$(git -C "$checkout" status --porcelain)"
node_bin="${AUTOPILOT_NODE_BIN:-/usr/bin/node}"
case "$("$node_bin" --version)" in
	v24.*) ;;
	*) exit 1 ;;
esac
test -f "$checkout/cockpit/dist/index.html"
test -z "$(find -P "$checkout/cockpit/dist" -mindepth 1 ! -type d ! -type f -print -quit)"

exec {lock_fd}<"$release_root"
flock -x "$lock_fd"

validate_child_directory() {
	local path="$1"
	local allow_writable="${2:-0}"
	test ! -L "$path"
	test -d "$path"
	test "$(stat -c %u -- "$path")" -eq "$expected_uid"
	test "$(stat -c %g -- "$path")" -eq "$expected_gid"
	if [ "$allow_writable" = "1" ]; then
		case "$(stat -c %a -- "$path")" in 555|755) ;; *) return 1 ;; esac
	else
		test "$(stat -c %a -- "$path")" = 555
	fi
}

for child in releases manifests; do
	child_path="$release_root/$child"
	if [ -e "$child_path" ] || [ -L "$child_path" ]; then
		if [ "$test_mode" = "1" ]; then
			validate_child_directory "$child_path" 1
		else
			validate_child_directory "$child_path"
		fi
	else
		mkdir -m 0755 -- "$child_path"
		validate_child_directory "$child_path" 1
	fi
done

releases="$release_root/releases"
manifests="$release_root/manifests"
if [ "$test_mode" = "1" ]; then
	chmod 0755 -- "$releases" "$manifests"
fi

candidate="$(mktemp -d -- "$releases/.candidate-${sha}.XXXXXXXXXX")"
temporary_manifest="$(mktemp -- "$manifests/.manifest-${sha}.XXXXXXXXXX")"
existing_manifest=""

cleanup() {
	if [ -n "${candidate:-}" ] && [ -d "$candidate" ] && [ ! -L "$candidate" ]; then
		chmod -R u+w -- "$candidate" 2>/dev/null || true
		rm -rf -- "$candidate"
	fi
	if [ -n "${temporary_manifest:-}" ] && [ -f "$temporary_manifest" ] && [ ! -L "$temporary_manifest" ]; then
		rm -f -- "$temporary_manifest"
	fi
	if [ -n "${existing_manifest:-}" ] && [ -f "$existing_manifest" ] && [ ! -L "$existing_manifest" ]; then
		rm -f -- "$existing_manifest"
	fi
	chmod 0555 -- "$releases" "$manifests" 2>/dev/null || true
}
trap cleanup EXIT

write_manifest() {
	local tree="$1"
	local output="$2"
	(
		cd "$tree"
		find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
	) > "$output"
}

validate_tree() {
	local tree="$1"
	test ! -L "$tree"
	test -d "$tree"
	test -z "$(find -P "$tree" -mindepth 1 ! -type d ! -type f -print -quit)"
	test -z "$(find -P "$tree" -type d \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0555 \) -print -quit)"
	test -z "$(find -P "$tree" -type f \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" -o ! -perm 0444 \) -print -quit)"
}

validate_manifest_file() {
	local path="$1"
	test ! -L "$path"
	test -f "$path"
	test "$(stat -c %u -- "$path")" -eq "$expected_uid"
	test "$(stat -c %g -- "$path")" -eq "$expected_gid"
	test "$(stat -c %a -- "$path")" = 444
}

cp -R --no-preserve=ownership,mode,timestamps "$checkout/cockpit/dist/." "$candidate/"
test -z "$(find -P "$candidate" -mindepth 1 ! -type d ! -type f -print -quit)"
find -P "$candidate" -type d -exec chmod 0555 {} +
find -P "$candidate" -type f -exec chmod 0444 {} +
if [ "$test_mode" != "1" ]; then
	chown -R 0:0 -- "$candidate"
fi
validate_tree "$candidate"
write_manifest "$candidate" "$temporary_manifest"
chmod 0444 -- "$temporary_manifest"
if [ "$test_mode" != "1" ]; then
	chown 0:0 -- "$temporary_manifest"
fi
validate_manifest_file "$temporary_manifest"

release="$releases/$sha"
manifest="$manifests/$sha.sha256"
release_exists=0
manifest_exists=0
if [ -e "$release" ] || [ -L "$release" ]; then release_exists=1; fi
if [ -e "$manifest" ] || [ -L "$manifest" ]; then manifest_exists=1; fi

if [ "$release_exists" -eq 1 ]; then
	validate_tree "$release"
	existing_manifest="$(mktemp -- "$manifests/.existing-${sha}.XXXXXXXXXX")"
	write_manifest "$release" "$existing_manifest"
	cmp -s "$temporary_manifest" "$existing_manifest"
	rm -f -- "$existing_manifest"
	existing_manifest=""
fi

if [ "$manifest_exists" -eq 1 ]; then
	validate_manifest_file "$manifest"
	cmp -s "$temporary_manifest" "$manifest"
fi

if [ "$release_exists" -eq 0 ]; then
	mv -T -- "$candidate" "$release"
	candidate=""
	if [ "$test_mode" = "1" ] && [ "${AUTOPILOT_STAGE_TEST_FAIL_AFTER_RELEASE:-0}" = "1" ]; then
		exit 75
	fi
else
	chmod -R u+w -- "$candidate"
	rm -rf -- "$candidate"
	candidate=""
fi

if [ "$manifest_exists" -eq 0 ]; then
	mv -T -- "$temporary_manifest" "$manifest"
	temporary_manifest=""
else
	rm -f -- "$temporary_manifest"
	temporary_manifest=""
fi

"$node_bin" -e 'process.stdout.write(`${JSON.stringify({ ok: true, sha: process.argv[1] })}\n`)' "$sha"
