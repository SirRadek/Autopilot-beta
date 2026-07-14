#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
	exit 1
fi

checkout="$(realpath "$1")"
release_root_input="$2"
test ! -L "$release_root_input"
release_root="$(realpath "$release_root_input")"

sha="$(git -C "$checkout" rev-parse HEAD)"
test -z "$(git -C "$checkout" status --porcelain)"
node_bin="${AUTOPILOT_NODE_BIN:-/usr/bin/node}"
case "$("$node_bin" --version)" in
	v24.*) ;;
	*) exit 1 ;;
esac
test -f "$checkout/cockpit/dist/index.html"
test -z "$(find "$checkout/cockpit/dist" -type l -print -quit)"

install -d -m 0755 "$release_root/releases" "$release_root/manifests"
candidate="$(mktemp -d "$release_root/releases/.candidate-${sha}.XXXXXX")"
temporary_manifest="$release_root/manifests/$sha.sha256.tmp"

cleanup() {
	if [ -n "${candidate:-}" ] && [ -d "$candidate" ]; then
		rm -rf "$candidate"
	fi
	if [ -n "${temporary_manifest:-}" ] && [ -f "$temporary_manifest" ]; then
		rm -f "$temporary_manifest"
	fi
}
trap cleanup EXIT

cp -R --no-preserve=ownership,mode,timestamps "$checkout/cockpit/dist/." "$candidate/"
find "$candidate" -type d -exec chmod 0755 {} +
find "$candidate" -type f -exec chmod 0644 {} +
(cd "$candidate" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$temporary_manifest"
(cd "$candidate" && sha256sum --check "$temporary_manifest" >/dev/null)

release="$release_root/releases/$sha"
manifest="$release_root/manifests/$sha.sha256"
if [ -e "$release" ] || [ -L "$release" ] || [ -e "$manifest" ] || [ -L "$manifest" ]; then
	test -d "$release"
	test ! -L "$release"
	test -f "$manifest"
	test ! -L "$manifest"
	cmp -s "$temporary_manifest" "$manifest"
	(cd "$release" && sha256sum --check "$manifest" >/dev/null)
	rm -rf "$candidate"
	candidate=""
	rm -f "$temporary_manifest"
	temporary_manifest=""
else
	find "$candidate" -type f -exec chmod 0444 {} +
	find "$candidate" -type d -exec chmod 0555 {} +
	chmod 0444 "$temporary_manifest"
	mv -T "$candidate" "$release"
	candidate=""
	mv -T "$temporary_manifest" "$manifest"
	temporary_manifest=""
fi

"$node_bin" -e 'process.stdout.write(`${JSON.stringify({ ok: true, sha: process.argv[1] })}\n`)' "$sha"
