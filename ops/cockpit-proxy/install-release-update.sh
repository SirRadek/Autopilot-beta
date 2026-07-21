#!/bin/bash
# Provisioning-boundary installer for the Cockpit static release-update worker.
#
# Production execution of the release-update worker is accepted only from the fixed,
# root-owned path /usr/local/libexec/autopilot-cockpit-release-update: the worker
# refuses any other $0 when running as root, so `bash ops/cockpit-proxy/release-update.sh`
# can never succeed in production. This installer is the supported way to publish that
# worker. It is run once by the image-provisioning root channel (the same channel that
# provisions the initial trusted launcher) -- never via `sudo npm` and never as a sudo'd
# checkout script in the operator loop. It integrity-pins the source bytes against
# ops/cockpit-proxy/release-update.provenance.json and installs atomically as root:root 0755.
#
# After installation, operators drive update / accept / recover by invoking the installed
# trusted worker directly (see docs/operations/service-runbook.md), e.g.
#   sudo /usr/local/libexec/autopilot-cockpit-release-update <checkout> /srv/autopilot-cockpit <sha>
# Running the installed, root-owned, integrity-verified worker under sudo is not a
# "sudo checkout script": it is the trusted path itself.
set -Eeuo pipefail

# A test build installs into an isolated /tmp root and validates against the invoking
# user instead of root, so the exact install/verify semantics can be exercised without
# touching the real host.
test_root="${AUTOPILOT_RELEASE_UPDATE_INSTALL_TEST_ROOT:-}"
expected_uid=0
expected_gid=0
if [ -n "$test_root" ]; then
	[ -d "$test_root" ] && [ ! -L "$test_root" ] || exit 1
	test_root="$(readlink -f -- "$test_root")"
	case "$test_root" in /tmp/*) ;; *) exit 1 ;; esac
	expected_uid="$(id -u)"
	expected_gid="$(id -g)"
	PATH="${AUTOPILOT_RELEASE_UPDATE_INSTALL_TEST_BIN:-/usr/bin}:/usr/bin:/bin"
else
	PATH=/usr/sbin:/usr/bin:/sbin:/bin
fi
export PATH

if [ -z "$test_root" ]; then
	[ "$EUID" -eq 0 ] || { printf '%s\n' "release-update installer requires EUID 0 (provisioning root channel)" >&2; exit 1; }
fi

source_dir="$(cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)"
worker_source="$source_dir/release-update.sh"
provenance="$source_dir/release-update.provenance.json"
target="$test_root/usr/local/libexec/autopilot-cockpit-release-update"
target_dir="$(dirname -- "$target")"

[ -f "$worker_source" ] && [ ! -L "$worker_source" ] || { printf '%s\n' "missing release-update worker source" >&2; exit 1; }
[ -f "$provenance" ] && [ ! -L "$provenance" ] || { printf '%s\n' "missing release-update provenance" >&2; exit 1; }

# Integrity pin: the worker bytes must equal the reviewed, committed hash. The pin makes
# tampering between review and install detectable and keeps the installed trusted worker
# identical to the source the mesh reviewed.
expected_sha="$(sed -n 's/.*"worker_sha256"[[:space:]]*:[[:space:]]*"\([a-f0-9]\{64\}\)".*/\1/p' "$provenance" | head -n 1)"
[[ "$expected_sha" =~ ^[a-f0-9]{64}$ ]] || { printf '%s\n' "release-update provenance is missing a valid worker_sha256" >&2; exit 1; }
source_sha="$(sha256sum -- "$worker_source" | awk '{print $1}')"
[ "$source_sha" = "$expected_sha" ] || { printf '%s\n' "release-update worker does not match pinned provenance" >&2; exit 1; }

[ -d "$target_dir" ] && [ ! -L "$target_dir" ] || { printf '%s\n' "trusted libexec directory is missing or a symlink" >&2; exit 1; }
# Never follow a symlink at the target path.
if [ -L "$target" ]; then printf '%s\n' "refusing symlinked trusted worker target" >&2; exit 1; fi
if [ -e "$target" ]; then [ -f "$target" ] || { printf '%s\n' "trusted worker target exists and is not a regular file" >&2; exit 1; }; fi

# If the correct worker is already installed with the required identity, this is an
# idempotent no-op.
if [ -f "$target" ] && [ ! -L "$target" ] \
	&& [ "$(stat -c %u:%g:%a -- "$target")" = "$expected_uid:$expected_gid:755" ] \
	&& [ "$(sha256sum -- "$target" | awk '{print $1}')" = "$expected_sha" ]; then
	printf 'RELEASE_UPDATE_WORKER_ALREADY_INSTALLED %s\n' "$expected_sha"
	exit 0
fi

umask 022
tmp="$(mktemp -- "$target_dir/.release-update.XXXXXXXXXX")"
trap 'rm -f -- "${tmp:-}"' EXIT
cat -- "$worker_source" > "$tmp"
chmod 0755 -- "$tmp"
if [ -z "$test_root" ]; then chown 0:0 -- "$tmp"; fi
[ "$(sha256sum -- "$tmp" | awk '{print $1}')" = "$expected_sha" ] || exit 1
[ "$(stat -c %u:%g:%a -- "$tmp")" = "$expected_uid:$expected_gid:755" ] || exit 1
mv -T -- "$tmp" "$target"
tmp=""
trap - EXIT

# Verify the installed worker satisfies the exact identity the worker self-enforces from
# its trusted path (non-symlink, expected owner, mode 0755, pinned bytes).
[ -f "$target" ] && [ ! -L "$target" ] || exit 1
[ "$(stat -c %u:%g:%a -- "$target")" = "$expected_uid:$expected_gid:755" ] || exit 1
[ "$(sha256sum -- "$target" | awk '{print $1}')" = "$expected_sha" ] || exit 1
printf 'RELEASE_UPDATE_WORKER_INSTALLED %s\n' "$expected_sha"
