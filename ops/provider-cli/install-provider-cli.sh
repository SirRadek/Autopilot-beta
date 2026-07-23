#!/usr/bin/env bash
# Single-sudo-pass installer for the codex/claude/agy provider CLI bundles.
# See docs/operations/provider-cli-install.md and
# docs/superpowers/plans/2026-07-23-vm-provider-cli-activation.md (Task 1).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MANIFEST="${PROVIDER_CLI_MANIFEST:-${SCRIPT_DIR}/CHECKSUMS.md}"
STAGING="${PROVIDER_CLI_STAGING:-/srv/provider-cli-staging}"
PRODUCTION_ROOT="/opt/autopilot-providers"

fail() {
  echo "install-provider-cli: $1" >&2
  exit 1
}

# The production install root is fixed and requires real root. The only way to redirect it
# is to set BOTH an explicit test-mode flag and an explicit test root override — one alone
# is never enough, so a stray env var can never silently repoint a production install.
if [ "${AUTOPILOT_PROVIDER_CLI_TEST_MODE:-}" = "1" ] && [ -n "${AUTOPILOT_PROVIDER_CLI_TEST_ROOT:-}" ]; then
  INSTALL_ROOT="${AUTOPILOT_PROVIDER_CLI_TEST_ROOT}"
  TEST_MODE=1
else
  [ "$(id -u)" -eq 0 ] || fail "must run as root (EUID 0); set AUTOPILOT_PROVIDER_CLI_TEST_MODE=1 and AUTOPILOT_PROVIDER_CLI_TEST_ROOT=<dir> for a non-production test run"
  INSTALL_ROOT="${PRODUCTION_ROOT}"
  TEST_MODE=0
fi

[ -f "$MANIFEST" ] || fail "manifest not found: $MANIFEST"
[ -d "$STAGING" ] || fail "staging directory not found: $STAGING"

# Preflight the install root identity before any mutation (mkdir -p below) ever happens.
if [ -L "$INSTALL_ROOT" ]; then
  fail "install root exists as a symlink, not a directory: $INSTALL_ROOT"
fi
if [ -e "$INSTALL_ROOT" ] && [ ! -d "$INSTALL_ROOT" ]; then
  fail "install root exists but is not a directory: $INSTALL_ROOT"
fi
if [ -L "${INSTALL_ROOT}/bin" ]; then
  fail "install root's bin/ exists as a symlink, not a directory: ${INSTALL_ROOT}/bin"
fi
if [ -e "${INSTALL_ROOT}/bin" ] && [ ! -d "${INSTALL_ROOT}/bin" ]; then
  fail "install root's bin/ exists but is not a directory: ${INSTALL_ROOT}/bin"
fi

# --- Parse the manifest table into parallel arrays -------------------------------------------
providers=()
versions=()
files=()
hashes=()
sizes=()

while IFS='|' read -r _ provider version file hash size _; do
  provider="$(echo "$provider" | xargs)"
  version="$(echo "$version" | xargs)"
  file="$(echo "$file" | xargs)"
  hash="$(echo "$hash" | xargs)"
  size="$(echo "$size" | xargs)"

  [ "$provider" = "provider" ] && continue
  [[ "$provider" =~ ^-+$ ]] && continue
  [ -z "$provider" ] && continue

  case "$provider" in
    codex|claude|agy) ;;
    *) fail "manifest lists unknown provider '$provider'" ;;
  esac
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || fail "manifest entry for '$file' has a malformed sha256"
  [[ "$size" =~ ^[0-9]+$ ]] || fail "manifest entry for '$file' has a malformed size"
  # Version and file are used to build filesystem paths below: reject anything but a plain,
  # single-segment token so no manifest row can escape the install root via traversal.
  [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "manifest entry for '$file' has an unsafe version '$version'"
  [[ "$file" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "manifest entry has an unsafe file name '$file'"

  providers+=("$provider")
  versions+=("$version")
  files+=("$file")
  hashes+=("$hash")
  sizes+=("$size")
done < "$MANIFEST"

entry_count="${#files[@]}"
[ "$entry_count" -eq 4 ] || fail "manifest must list exactly 4 files, found $entry_count"

# --- Enforce the exact provider/file/version mapping the manifest is required to carry --------
declare -A expected_provider_files=( [codex]="codex codex-code-mode-host" [claude]="claude" [agy]="agy" )
declare -A manifest_provider_files=()
declare -A manifest_provider_version=()

for i in "${!providers[@]}"; do
  provider="${providers[$i]}"
  file="${files[$i]}"
  version="${versions[$i]}"

  if [ -n "${manifest_provider_version[$provider]:-}" ] && [ "${manifest_provider_version[$provider]}" != "$version" ]; then
    fail "manifest lists provider '$provider' with conflicting versions '${manifest_provider_version[$provider]}' and '$version'"
  fi
  manifest_provider_version[$provider]="$version"

  manifest_provider_files[$provider]="${manifest_provider_files[$provider]:-} ${file}"
done

for provider in codex claude agy; do
  expected="$(echo "${expected_provider_files[$provider]}" | tr ' ' '\n' | sort | tr '\n' ' ')"
  actual="$(echo "${manifest_provider_files[$provider]:-}" | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')"
  [ "$actual" = "$expected" ] || fail "manifest lists the wrong artifact mapping for provider '$provider': expected '${expected_provider_files[$provider]}', got '${manifest_provider_files[$provider]:-}'"
done

# --- Validate staging: exact file count, regular files only, no extras, hash+size match ------
staging_entries=()
while IFS= read -r -d '' entry; do
  staging_entries+=("$(basename "$entry")")
done < <(find "$STAGING" -mindepth 1 -maxdepth 1 -print0)

staging_count="${#staging_entries[@]}"
[ "$staging_count" -eq "$entry_count" ] || fail "staging directory must contain exactly $entry_count files, found $staging_count"

for name in "${staging_entries[@]}"; do
  path="${STAGING}/${name}"
  if [ -L "$path" ]; then
    fail "staged file '$name' is a symlink; only regular files are accepted"
  fi
  if [ ! -f "$path" ]; then
    fail "staged file '$name' is not a regular file"
  fi
  found=0
  for f in "${files[@]}"; do
    [ "$f" = "$name" ] && found=1 && break
  done
  [ "$found" -eq 1 ] || fail "staged file '$name' is not listed in the manifest"
done

total_expected_size=0
total_actual_size=0
for i in "${!files[@]}"; do
  file="${files[$i]}"
  path="${STAGING}/${file}"
  [ -e "$path" ] || fail "manifest file '$file' missing from staging"

  actual_size="$(stat -c%s "$path")"
  [ "$actual_size" = "${sizes[$i]}" ] || fail "size mismatch for '$file': expected ${sizes[$i]}, got $actual_size"

  actual_hash="$(sha256sum "$path" | awk '{print $1}')"
  [ "$actual_hash" = "${hashes[$i]}" ] || fail "sha256 mismatch for '$file': expected ${hashes[$i]}, got $actual_hash"

  total_expected_size=$((total_expected_size + ${sizes[$i]}))
  total_actual_size=$((total_actual_size + actual_size))
done

[ "$total_actual_size" -eq "$total_expected_size" ] || fail "combined staging size mismatch: expected ${total_expected_size} bytes, got ${total_actual_size} bytes"

# --- Every input verified; only now may destinations be inspected (still read-only) ----------

bin_dir="${INSTALL_ROOT}/bin"

install_owner_args=()
if [ "$TEST_MODE" -eq 0 ]; then
  install_owner_args=(-o root -g root)
fi

# codex has 2 files installed but only 1 symlinked ("codex"); claude/agy each have 1 of both.
declare -A symlink_file=( [codex]="codex" [claude]="claude" [agy]="agy" )
declare -A provider_version=()
declare -A provider_indices=()

for provider in codex claude agy; do
  version=""
  idxs=""
  for i in "${!providers[@]}"; do
    if [ "${providers[$i]}" = "$provider" ]; then
      version="${versions[$i]}"
      idxs="${idxs} ${i}"
    fi
  done
  [ -n "$version" ] || fail "manifest is missing an entry for provider '$provider'"
  provider_version[$provider]="$version"
  provider_indices[$provider]="$idxs"
done

# --- Preflight: verify every destination's identity for every provider before any mutation ----
# happens. A conflict discovered for provider N must never leave partial changes from providers
# processed before it.
for provider in codex claude agy; do
  version="${provider_version[$provider]}"
  provider_root="${INSTALL_ROOT}/${provider}"
  target_dir="${provider_root}/${version}"

  if [ -L "$provider_root" ]; then
    fail "provider root exists as a symlink, not a directory: $provider_root"
  fi
  if [ -e "$provider_root" ] && [ ! -d "$provider_root" ]; then
    fail "provider root exists but is not a directory: $provider_root"
  fi

  if [ -L "$target_dir" ]; then
    fail "target version path exists as a symlink, not a directory: $target_dir"
  fi
  if [ -e "$target_dir" ]; then
    # Target version directory already exists: fail closed unless every file already matches
    # the manifest's identity exactly (idempotent re-run). Never delete or overwrite in place.
    [ -d "$target_dir" ] || fail "target version path exists but is not a directory: $target_dir"
    for i in ${provider_indices[$provider]}; do
      file="${files[$i]}"
      existing="${target_dir}/${file}"
      [ -f "$existing" ] && [ ! -L "$existing" ] || fail "target version exists with wrong identity: $existing missing or not a regular file"
      existing_hash="$(sha256sum "$existing" | awk '{print $1}')"
      [ "$existing_hash" = "${hashes[$i]}" ] || fail "target version exists with wrong identity: $existing does not match manifest sha256"
    done
  fi

  link_path="${bin_dir}/${provider}"
  if [ -e "$link_path" ] || [ -L "$link_path" ]; then
    [ -L "$link_path" ] || fail "bin destination exists but is not a symlink: $link_path"
  fi
done

# --- All destination preflight has passed; only now may bin/ itself be created ----------------
mkdir -p "$bin_dir"

# --- Stage: build each new version's artifacts in a private temporary directory, fully verified
# there, before anything is renamed into its final, visible location.
declare -A provider_needs_install=()
declare -A provider_temp_dir=()

cleanup_staged_dirs() {
  exit_code=$?
  for provider in codex claude agy; do
    tmp="${provider_temp_dir[$provider]:-}"
    [ -n "$tmp" ] && [ -d "$tmp" ] && rm -rf "$tmp"
  done
  exit "$exit_code"
}
trap cleanup_staged_dirs EXIT

for provider in codex claude agy; do
  version="${provider_version[$provider]}"
  provider_root="${INSTALL_ROOT}/${provider}"
  target_dir="${provider_root}/${version}"

  if [ -d "$target_dir" ]; then
    provider_needs_install[$provider]=0
    continue
  fi
  provider_needs_install[$provider]=1

  mkdir -p "$provider_root"
  tmp_dir="$(mktemp -d "${provider_root}/.provider-cli-stage-XXXXXX")"
  provider_temp_dir[$provider]="$tmp_dir"
  chmod 0755 "$tmp_dir"
  if [ "$TEST_MODE" -eq 0 ]; then
    chown root:root "$tmp_dir"
  fi

  for i in ${provider_indices[$provider]}; do
    file="${files[$i]}"
    install "${install_owner_args[@]}" -m 0755 "${STAGING}/${file}" "${tmp_dir}/${file}"

    # Re-hash the installed copy before it is ever renamed into a visible location.
    installed_hash="$(sha256sum "${tmp_dir}/${file}" | awk '{print $1}')"
    [ "$installed_hash" = "${hashes[$i]}" ] || fail "post-install re-hash mismatch for ${tmp_dir}/${file}"
  done
done

# --- Publish, phase 1: rename verified temp version dirs into place ---------------------------
# All artifacts for all providers are valid at this point; only now may a version directory
# become visible under its final path.
declare -A dir_published=()
dirs_publish_failed=0
for provider in codex claude agy; do
  dir_published[$provider]=0
  [ "${provider_needs_install[$provider]}" -eq 1 ] || continue
  version="${provider_version[$provider]}"
  target_dir="${INSTALL_ROOT}/${provider}/${version}"
  tmp_dir="${provider_temp_dir[$provider]}"
  if mv -T "$tmp_dir" "$target_dir"; then
    dir_published[$provider]=1
  else
    dirs_publish_failed=1
    break
  fi
done

if [ "$dirs_publish_failed" -eq 1 ]; then
  for provider in codex claude agy; do
    [ "${dir_published[$provider]:-0}" -eq 1 ] || continue
    rm -rf "${INSTALL_ROOT}/${provider}/${provider_version[$provider]}"
  done
  fail "failed to publish a version directory; no stable link was touched"
fi

# --- Publish, phase 2: atomically repoint every stable symlink, or roll all of them back -------
declare -A prev_link_existed=()
declare -A prev_link_target=()
declare -A link_published=()

for provider in codex claude agy; do
  link_path="${bin_dir}/${provider}"
  if [ -L "$link_path" ]; then
    prev_link_existed[$provider]=1
    prev_link_target[$provider]="$(readlink "$link_path")"
  else
    prev_link_existed[$provider]=0
    prev_link_target[$provider]=""
  fi
  link_published[$provider]=0
done

rollback_links() {
  for provider in codex claude agy; do
    [ "${link_published[$provider]:-0}" -eq 1 ] || continue
    link_path="${bin_dir}/${provider}"
    if [ "${prev_link_existed[$provider]}" -eq 1 ]; then
      restore_tmp="${link_path}.rollback.$$"
      ln -s "${prev_link_target[$provider]}" "$restore_tmp"
      mv -T "$restore_tmp" "$link_path"
    else
      rm -f "$link_path"
    fi
  done
}

# Test-only publication failure injection: only takes effect when TEST_MODE is on, so this
# can never repoint or disrupt a production install regardless of what the flag is set to.
test_fail_link="${AUTOPILOT_PROVIDER_CLI_TEST_FAIL_LINK:-}"

links_publish_failed=0
for provider in codex claude agy; do
  version="${provider_version[$provider]}"
  target_dir="${INSTALL_ROOT}/${provider}/${version}"
  link_file="${symlink_file[$provider]}"
  link_path="${bin_dir}/${provider}"
  link_target="${target_dir}/${link_file}"

  if [ "$TEST_MODE" -eq 1 ] && [ -n "$test_fail_link" ] && [ "$test_fail_link" = "$provider" ]; then
    links_publish_failed=1
    break
  fi

  # Atomic publication: build the new symlink next to the target, then rename over the old one.
  tmp_link="${link_path}.new.$$"
  if ln -s "$link_target" "$tmp_link" && mv -T "$tmp_link" "$link_path"; then
    link_published[$provider]=1
  else
    rm -f "$tmp_link"
    links_publish_failed=1
    break
  fi
done

if [ "$links_publish_failed" -eq 1 ]; then
  rollback_links
  for provider in codex claude agy; do
    [ "${dir_published[$provider]:-0}" -eq 1 ] || continue
    rm -rf "${INSTALL_ROOT}/${provider}/${provider_version[$provider]}"
  done
  fail "failed to publish a stable symlink; rolled every stable link back to its prior state and removed newly published version directories"
fi

echo "install-provider-cli: installed codex, claude, agy under ${INSTALL_ROOT}"
