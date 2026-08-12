# Windows Project Import (Staged, Non-Destructive) Plan

> **Historical record — do not execute.** This plan predates retirement of
> `CONTROL_PLANE_TOKEN`. Use the current [authentication](../../operations/configuration.md) and
> [service](../../operations/service-runbook.md) procedures instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is operations + one small TDD helper script; treat rsync/ssh steps as ordinary checklist steps and the registry-mutation script as a normal TDD task.

**Goal:** Non-destructively copy the 18 top-level projects (excluding any `autopilot`/`autopilot-beta` directory) from the read-only source `/media/radek/B2768BFD768BC119/Programování/Projects` into the VM at `radek@192.168.122.99:/home/radek/projects`, then register each imported project in the managed `projects.json` registry via the repository's `projectRegistry` module — without touching token/routing config, without overwriting any existing VM destination, and with fail-closed secret exclusion.

**Non-goals (explicitly out of scope for this plan):** implementing/wiring a "provider bridge" for these newly imported projects (identified below as a separate follow-up blocker), modifying the VM beyond writing into `/home/radek/projects/<project>/`, mounting/unmounting anything, committing any changes, and any code changes to `projectRegistry.ts`/`stateMaintenanceLock.ts` themselves (they are used as-is).

**Architecture:** Two independent stages per project, run sequentially project-by-project (staged, not parallel, to bound VM disk and let each project be verified before the next starts):
1. **Copy stage:** `rsync -e ssh` over SSH from the read-only source directly to a *staging* path on the VM (`~/projects/.import-staging/<project>/`), with an explicit include/exclude filter file, `--dry-run` verification pass first, then the real transfer, then a checksum re-verification pass, then an atomic `mv` from staging into the final `~/projects/<project>/` path (atomic because same filesystem, single rename). No destination directory is ever overwritten — the whole project is skipped with a logged warning if `~/projects/<project>` already exists.
2. **Registry stage:** After *all* copy stages succeed (or are intentionally skipped), a single Node 24 script acquires the `stateMaintenanceLock`, reads `projects.json` via `readProjectRegistry`, adds one `ProjectEntry` per newly-copied project (skipping any `project_id` that already exists), and writes it back via `writeProjectRegistry` — a single atomic read-modify-write covering the whole batch.

Verification closes the loop: manifest diffed against source dry-run byte/file counts, a second independent dry-run/checksum pass post-copy, and finally live HTTP checks against `/ready` and `/projects` through the authenticated control-plane, with the bearer token read from environment and never printed.

**Tech Stack:** Bash + `rsync`/`ssh`/`sha256sum` for transfer and verification; Node 24 + `tsx` + existing `src/data/delivery-system/projectRegistry.ts` / `stateMaintenanceLock.ts` for the registry mutation; `curl` for HTTP verification. No new runtime dependencies.

## Global Constraints

- Source `/media/radek/B2768BFD768BC119/Programování/Projects` is **read-only input**: every command touching it uses `rsync --dry-run` first and the real run always uses source-as-sender, VM-as-receiver; never write, `chmod`, or delete inside the source tree. Read-only local inspection of the source tree's own Git metadata (e.g. `git ls-files -s -z`) is allowed and does not violate read-only status.
- Never mount/unmount any filesystem, never modify the VM outside `/home/radek/projects/`, and never run any command that stages/commits/pushes in this repository as part of this plan.
- All SSH/rsync-over-ssh commands use the dedicated key `/home/radek/.ssh/autopilot-vm_ed25519` (`-i /home/radek/.ssh/autopilot-vm_ed25519` on `ssh`, `-e "ssh -i /home/radek/.ssh/autopilot-vm_ed25519"` on `rsync`).
- Project selection is an **explicit 18-name top-level allowlist** (the `PROJECTS` array in Task 1 Step 3) — this is the only mechanism that keeps `autopilot`/`autopilot-beta` out of the import; there is no nested-directory `autopilot`/`autopilot-beta` exclusion rule inside the filter file, because such a rule would also wrongly exclude any legitimately-named `autopilot*` subpath inside one of the 18 allowed projects.
- Exclude restorable caches/build artifacts at any depth using `**/name/***` patterns: `**/node_modules/***`, `**/.venv/***`, `**/.venvs/***`, `**/venv/***`, `**/env/***`, `**/.mypy_cache/***`, `**/.pytest_cache/***`, `**/__pycache__/***`, `**/.next/***`, `**/.nuxt/***`, `**/dist/***`, `**/build/***`, `**/target/***`, `**/Library/***`, `**/Temp/***`, `**/obj/***` (Unity), `**/.cache/***`; and specifically, project-relative (anchored to each project's own root, not nested under `TrendVerse/`) `/external/forge-oneclick/***` and `/external/forge-oneclick-cu121/***`.
- Preserve `.git/`, `source/`, `assets/`, `data/`, `outputs/`, `artifacts/`, `exports/` (these are never excluded even if they collide with a cache pattern above) — the filter file lists them as explicit includes placed *after* the secret excludes but *before* the cache excludes, so a secret match still wins even inside a preserved directory, while a preserved directory still wins over a cache-name collision.
- Fail-closed secret handling: `Crypto_Analyzer/.env` is always excluded; additionally exclude any file matching `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*.pfx`, `*.p12`, `*_rsa`, `.env`, `.env.*`, `*credentials*.json`, `*secret*.json`, `*.keystore`, `.npmrc` (may contain tokens), `.netrc`. These secret-exclude rules match anywhere in the tree and are placed **first** in the filter file, before every include/protect rule and every cache-exclude rule, so rsync's first-match-wins semantics can never let a preserved directory (e.g. `data/`) re-admit a secret file. The manifest step must never print file *contents* — only relative paths, sizes, and a boolean "excluded-as-secret" flag.
- No destination overwrite: if `/home/radek/projects/<project>` already exists on the VM before staging that project, skip the whole project (do not partial-merge) and record it in the run log.
- Preserve Git executable bits: because `--chmod` is applied for privacy, restore `.git/hooks/*` and any file `git ls-files -s -z` marks as mode `100755` inside each copied working tree back to mode `700` after transfer, sourced from the *source* tree's own git index (not guessed). The restoration must be NUL-safe (`-z`/`-print0`-style delimiting throughout) and must never interpolate a filename into a remote shell command string — file lists are transferred as data (e.g. piped over `ssh ... 'command' < list` or written to a file and read remotely with a NUL-delimited loop) and only fixed, literal commands are interpolated into the remote shell invocation itself.
- Destination file modes: directories `700`, regular files `600`, restore executables per the git-index step above to `700`. No group- or world-readable/writable bits anywhere under the imported trees.
- Disk preflight consumes the **fresh filtered JSON manifest** produced in Task 1 (per-project and total bytes/files, computed from the corrected filter file), not a hardcoded byte count — the previously-seen figure of 5,063,698,534 bytes / 15,342 files is an **upper-bound reference only** (it predates the secret-exclude-ordering and cache-pattern corrections and will legitimately be equal to or larger than the fresh total). VM has 11 GiB (11 × 1024³ = 11,811,160,064 bytes) free. Required reserve: copy needs source bytes **twice** transiently in the worst case only if staging and final both existed simultaneously for the same project — they do not (atomic `mv`, not `cp`), so peak usage is source bytes once plus staging-in-flight for the single currently-copying project. Preflight must confirm `available_bytes - manifest_total_bytes > 1_073_741_824` (≥1 GiB safety margin after full import) before starting, and re-check available space before *each* project's transfer, aborting the whole run (not just that project) if margin drops below 512 MiB mid-run.
- All registry mutation goes through `readProjectRegistry` / `writeProjectRegistry` / the exported synchronous `withStateMaintenanceLock(stateDirectory, callback)` from `src/data/delivery-system/stateMaintenanceLock.ts` (callback is a plain synchronous function, not async — the lock helper is reentrant via an internal lease-depth counter, so nested acquisition inside the same process is safe) exactly as implemented in `src/data/delivery-system/projectRegistry.ts` and `src/data/delivery-system/stateMaintenanceLock.ts` — no direct `projects.json` edits, no ad hoc JSON.stringify writes.
- The registry-mutation helper is written and dry-run tested locally in this repository checkout (Task 4), then transferred file-by-file into the private staging directory `/home/radek/projects/.import-staging` and executed against the real deployed modules at the absolute path `/home/radek/autopilot-beta` (Task 5) — never assume or require a VM checkout of this `release-baseline-repair` worktree; the deployed modules already exist at `/home/radek/autopilot-beta/src/data/delivery-system/projectRegistry.ts` and `.../stateMaintenanceLock.ts` and must be imported from there, unmodified, by absolute path.
- The helper module uses the ESM entry-point guard `import.meta.url === \`file://${process.argv[1]}\`` (or equivalent `pathToFileURL(process.argv[1]).href` comparison) to detect direct invocation — never `require.main === module`, which does not exist under ESM (`tsx` runs this repository's `.ts` sources as ESM per `package.json` `"type": "module"`).
- Before any registry mutation on the VM: source `~/.config/autopilot/control-plane.env` into the current shell (`set -a; source ~/.config/autopilot/control-plane.env; set +a`) without ever printing its contents or `env`-dumping after sourcing; confirm the VM's Node binary is exactly `/usr/bin/node` at version `v24.x`; confirm `autopilot-control-plane.service` is a **system** service unit (`systemctl status`, never `systemctl --user`) and listening on port `8787` on loopback only.
- The sole file this plan ever writes outside the imported project roots and the local scratch/staging paths is the VM's managed `projects.json` registry file at `$AUTOPILOT_STATE_DIR/projects.json` (`/home/radek/.local/state/autopilot/projects.json`), written only via `writeProjectRegistry`.
- Before the registry mutation runs, take an identity-pinned, bounded backup of the current `projects.json` (copy to a fixed, timestamp-free, single well-known backup path inside the state directory's own `backups/` subdirectory, e.g. `$AUTOPILOT_STATE_DIR/backups/projects.json.pre-import-$(sha256 of current content, first 12 hex chars).bak`, mode `600`, fail-closed verified as a regular non-symlink file at that exact mode; an already-existing hash-named backup at that path is only validated, never re-copied/overwritten), validate the backup is byte-identical to the live file immediately after copying (checksum comparison), and only then proceed to mutate; if post-write verification (Task 5 Step 3/4 HTTP checks) fails, the exact atomic rollback is the helper's own exported `runRestore(stateDir, backupPath)` (Task 4), invoked via its `--restore STATE_DIR BACKUP_PATH` CLI mode (Task 5 Step 8) — it re-reads and JSON-parses the validated backup, writes it back through the same atomic `writeProjectRegistry` path the module already uses, then re-reads and asserts the result matches — never a raw `cp`/`mv` over the live file — do this rollback only on a confirmed post-write verification failure, never speculatively.
- `project_id` values must be unique, lowercase, and match `^[a-z0-9][a-z0-9._-]{0,79}$` (existing `PROJECT_ID_PATTERN`); derive by lowercasing the directory name and replacing any character outside `[a-z0-9._-]` with `-` (table given in Task 3).
- Preserve every preexisting registry entry untouched; only *append* entries for the 18 imported projects, and only for those that actually landed on the VM (skipped projects get no entry). If a `project_id` collision exists already in the registry, skip that project's registry entry and log it — do not overwrite.
- `cwd` for each new entry must be the absolute, `normalize()`-equal VM path `/home/radek/projects/<project>` and must resolve inside the configured project root (`AUTOPILOT_PROJECTS_DIR`, default `~/projects` on the VM) per `resolveEnabledProject`.
- Node 24 only (`engines.node: ">=24 <25"`) for the registry script; run it with `tsx` exactly like the existing `projects:init` npm script does.
- Do not touch token, provider, or routing configuration anywhere in this plan.
- No placeholders in commands actually run — every command below is copy-pasteable; the only externally-supplied value is the control-plane bearer token, read from the `CONTROL_PLANE_TOKEN` environment variable (sourced from `~/.config/autopilot/control-plane.env`) and never echoed/printed/logged. Port is always the confirmed literal `8787` (never a `:PORT` placeholder); state directory is always the confirmed literal `/home/radek/.local/state/autopilot`; deployed module path is always the confirmed literal `/home/radek/autopilot-beta`; this plan never references the VM having a `release-baseline-repair` checkout and never assumes one exists.
- Any code written (the registry-mutation helper) follows TDD: write a failing test first, confirm RED, implement, confirm GREEN.
- **Operator checkpoints** are marked explicitly below; do not proceed past them without explicit human go-ahead in this session.

---

### Task 1: Build the rsync filter file and derive the fresh filtered manifest

**Files:**
- Create (local scratch, not committed): `/tmp/windows-import/rsync-filters.txt`
- Create (local scratch): `/tmp/windows-import/secret-scan.txt`
- Create (local scratch): `/tmp/windows-import/manifest.json`

- [ ] **Step 1: Create scratch workspace**

```bash
mkdir -p /tmp/windows-import
chmod 700 /tmp/windows-import
```

- [ ] **Step 2: Write the rsync filter file** (applies identically to every project; the 18-name `PROJECTS` allowlist in Step 3 is what keeps `autopilot`/`autopilot-beta` out — there is no nested-directory `autopilot` exclusion rule here. Order is: secret excludes first — matching anywhere, before every include — then the preserved-directory includes, then the cache excludes.)

```
# /tmp/windows-import/rsync-filters.txt

# Secret / credential exclusions (fail-closed, never transferred; matched
# anywhere in the tree; MUST precede every include/protect rule below so a
# preserved directory can never re-admit a secret file)
- .env
- .env.*
- *.pem
- *.key
- id_rsa*
- id_ed25519*
- *.pfx
- *.p12
- *_rsa
- *credentials*.json
- *secret*.json
- *.keystore
- .npmrc
- .netrc
- Crypto_Analyzer/.env

# Preserved directories (protected from the cache excludes below)
+ /.git/
+ /.git/**
+ /source/
+ /source/**
+ /assets/
+ /assets/**
+ /data/
+ /data/**
+ /outputs/
+ /outputs/**
+ /artifacts/
+ /artifacts/**
+ /exports/
+ /exports/**

# Restorable caches / build artifacts (any depth)
- **/node_modules/***
- **/.venv/***
- **/.venvs/***
- **/venv/***
- **/env/***
- **/.mypy_cache/***
- **/.pytest_cache/***
- **/__pycache__/***
- **/.next/***
- **/.nuxt/***
- **/dist/***
- **/build/***
- **/target/***
- **/Library/***
- **/Temp/***
- **/obj/***
- **/.cache/***

# Project-relative excludes (anchored to each project's own root)
- /external/forge-oneclick/***
- /external/forge-oneclick-cu121/***
```

- [ ] **Step 3: Run the corrected filter against the explicit 18-name allowlist and derive the fresh filtered JSON manifest** (per-project and total bytes/files; the previously-seen 5,063,698,534 bytes / 15,342 files figure is an **upper-bound reference only** — it predates this filter's secret-ordering and cache-pattern corrections, so the fresh total must be ≤ that reference, never used as a pass/fail gate)

```bash
SRC="/media/radek/B2768BFD768BC119/Programování/Projects"
PROJECTS=(Crypto_Analyzer TestingAgent TrendVerse True Vzory autopilot-console \
  bomboklade-freelance-site clienthub-mvp db-move-kit importguard radeq \
  radeq-showcase radeq-showcase-fable radeq-showcase-prototype scrapeflow \
  seo-fix-pack webhook-gateway zednik-hero)

: > /tmp/windows-import/manifest.json
{
  echo '{"projects":['
  first=1
  TOTAL_BYTES=0
  TOTAL_FILES=0
  for p in "${PROJECTS[@]}"; do
    out=$(rsync -a --dry-run --stats \
      --filter="merge /tmp/windows-import/rsync-filters.txt" \
      "$SRC/$p/" "/tmp/windows-import/dryrun-placeholder/$p/" 2>&1)
    bytes=$(echo "$out" | awk -F': ' '/Total file size/{gsub(",","",$2); print $2; exit}')
    files=$(echo "$out" | awk -F': ' '/Number of regular files transferred/{gsub(",","",$2); print $2; exit}')
    TOTAL_BYTES=$((TOTAL_BYTES + bytes))
    TOTAL_FILES=$((TOTAL_FILES + files))
    [ "$first" = 1 ] || echo ','
    first=0
    printf '{"project":"%s","files":%s,"bytes":%s}' "$p" "$files" "$bytes"
  done
  echo
  echo '],'
  printf '"total_files":%s,"total_bytes":%s,"reference_upper_bound_bytes":5063698534,"reference_upper_bound_files":15342}\n' \
    "$TOTAL_FILES" "$TOTAL_BYTES"
} > /tmp/windows-import/manifest.json
cat /tmp/windows-import/manifest.json
chmod 600 /tmp/windows-import/manifest.json
```

- [ ] **Step 4: Build the privacy-safe secret manifest** (paths + sizes only, never contents; confirms the exclude filters actually match every known-sensitive file before real transfer)

```bash
SRC="/media/radek/B2768BFD768BC119/Programování/Projects"
: > /tmp/windows-import/secret-scan.txt
for p in "${PROJECTS[@]}"; do
  find "$SRC/$p" -type f \( \
    -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \
    -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.pfx' -o -name '*.p12' \
    -o -name '*_rsa' -o -name '*credentials*.json' -o -name '*secret*.json' \
    -o -name '*.keystore' -o -name '.npmrc' -o -name '.netrc' \
  \) -printf '%s\t%p\n' >> /tmp/windows-import/secret-scan.txt
done
wc -l /tmp/windows-import/secret-scan.txt
chmod 600 /tmp/windows-import/secret-scan.txt
```

- [ ] **Step 5 — OPERATOR CHECKPOINT:** Review `/tmp/windows-import/secret-scan.txt` (paths/sizes only) and `/tmp/windows-import/manifest.json` (fresh per-project/total bytes/files, with the old figure shown only as `reference_upper_bound_*`). Confirm with the operator that every listed secret path is indeed excluded by the filter file (spot-check with `rsync --dry-run -i` showing an `excluded` result for 3–5 sample paths) before proceeding to Task 2.

```bash
rsync -a --dry-run -i --filter="merge /tmp/windows-import/rsync-filters.txt" \
  "$SRC/Crypto_Analyzer/" "/tmp/windows-import/dryrun-placeholder/Crypto_Analyzer/" \
  | grep -F '.env' || echo "OK: .env not listed as transferred"
```

---

### Task 2: Preflight VM disk space and staging layout

**Files:** none created in this repo; VM-side only, under `~/projects/.import-staging/`.

- [ ] **Step 1: Confirm VM reachability and free space**

```bash
SSH_KEY=/home/radek/.ssh/autopilot-vm_ed25519
ssh -i "$SSH_KEY" radek@192.168.122.99 'df --output=avail -B1 /home/radek/projects | tail -1'
```

- [ ] **Step 2: Compute and assert the margin locally, using the fresh manifest total (not the old hardcoded byte count)** (abort the whole plan here if this fails — do not proceed to any transfer)

```bash
SSH_KEY=/home/radek/.ssh/autopilot-vm_ed25519
AVAIL=$(ssh -i "$SSH_KEY" radek@192.168.122.99 'df --output=avail -B1 /home/radek/projects | tail -1' | tr -d ' ')
NEED=$(python3 -c "import json; print(json.load(open('/tmp/windows-import/manifest.json'))['total_bytes'])")
python3 -c "
avail=$AVAIL
need=$NEED
margin=avail-need
assert margin > 1073741824, f'INSUFFICIENT SPACE: avail={avail} need={need} margin={margin}'
print(f'OK margin_bytes={margin}')
"
```

- [ ] **Step 3: Create the staging directory tree with private modes (idempotent, does not touch existing project dirs)**

```bash
SSH_KEY=/home/radek/.ssh/autopilot-vm_ed25519
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -e
  mkdir -p /home/radek/projects/.import-staging
  chmod 700 /home/radek/projects/.import-staging
'
```

- [ ] **Step 4: Enumerate which of the 18 destinations already exist (these will be skipped, not overwritten) and record the list**

```bash
SSH_KEY=/home/radek/.ssh/autopilot-vm_ed25519
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  for p in Crypto_Analyzer TestingAgent TrendVerse True Vzory autopilot-console \
    bomboklade-freelance-site clienthub-mvp db-move-kit importguard radeq \
    radeq-showcase radeq-showcase-fable radeq-showcase-prototype scrapeflow \
    seo-fix-pack webhook-gateway zednik-hero; do
    if [ -e "/home/radek/projects/$p" ]; then echo "EXISTS:$p"; else echo "FREE:$p"; fi
  done
' | tee /tmp/windows-import/destination-status.txt
```

- [ ] **Step 5: Generate the exact `import-list.json` / `skip-list.json` manifests from the destination status** (no shell-array placeholders — these JSON files are the source of truth Task 3 reads from)

```bash
python3 -c "
import json
lines = [l.strip() for l in open('/tmp/windows-import/destination-status.txt') if l.strip()]
imp = [l.split(':',1)[1] for l in lines if l.startswith('FREE:')]
skip = [l.split(':',1)[1] for l in lines if l.startswith('EXISTS:')]
json.dump({'import': imp}, open('/tmp/windows-import/import-list.json','w'), indent=2)
json.dump({'skip': skip}, open('/tmp/windows-import/skip-list.json','w'), indent=2)
print('import:', imp)
print('skip:', skip)
"
```

- [ ] **Step 6 — OPERATOR CHECKPOINT:** Review `/tmp/windows-import/import-list.json` and `/tmp/windows-import/skip-list.json`. Confirm the operator wants to skip every entry in `skip-list.json` (per the no-overwrite constraint) before Task 3 begins.

---

### Task 3: Staged per-project copy, checksum verification, and atomic publish

Run this loop only over the entries in `/tmp/windows-import/import-list.json` from Task 2 Step 5/6 (i.e., skip anything in `skip-list.json`). Process one project at a time — do not parallelize — so disk margin and verification stay bounded per project.

**Files:** VM-side `~/projects/.import-staging/<project>/` → `~/projects/<project>/`. No repo files.

- [ ] **Step 1: Per-project dry-run (second, pre-transfer independent check) against the live VM target**

```bash
SRC="/media/radek/B2768BFD768BC119/Programování/Projects"
SSH_KEY=/home/radek/.ssh/autopilot-vm_ed25519
copy_project() {
  p="$1"
  echo "=== $p: dry-run ==="
  rsync -av --dry-run --stats \
    -e "ssh -i $SSH_KEY" \
    --filter="merge /tmp/windows-import/rsync-filters.txt" \
    "$SRC/$p/" "radek@192.168.122.99:/home/radek/projects/.import-staging/$p/"
```

- [ ] **Step 2: Real transfer into staging with private modes, preserving times, then re-verify by checksum**

```bash
  echo "=== $p: transfer ==="
  rsync -a \
    -e "ssh -i $SSH_KEY" \
    --filter="merge /tmp/windows-import/rsync-filters.txt" \
    --chmod=D700,F600 \
    --checksum \
    "$SRC/$p/" "radek@192.168.122.99:/home/radek/projects/.import-staging/$p/"

  echo "=== $p: second checksum verification pass (dry-run, checksum mode, expect zero diffs) ==="
  DIFF=$(rsync -a --dry-run -i --checksum \
    -e "ssh -i $SSH_KEY" \
    --filter="merge /tmp/windows-import/rsync-filters.txt" \
    --chmod=D700,F600 \
    "$SRC/$p/" "radek@192.168.122.99:/home/radek/projects/.import-staging/$p/")
  if [ -n "$DIFF" ]; then
    echo "VERIFICATION FAILED for $p:"; echo "$DIFF"; return 1
  fi
  echo "$p: checksum-verified clean"
```

Note: the verification dry-run must be given the same `--chmod=D700,F600` as the real transfer, otherwise it compares source-default modes against the privacy-restricted destination modes and reports spurious permission-only diffs (confirmed root cause of Task 3's original non-zero `corrected_verification_diff_count`). The comparison must model the *intended* destination modes, not the source's as-is modes.

- [ ] **Step 3: Restore Git executable bits to `700` from the source tree's own git index (not guessed), inside staging, before publish — NUL-safe throughout, no filename ever interpolated into a remote shell command string**

```bash
  echo "=== $p: restoring git executable bits ==="
  if [ -d "$SRC/$p/.git" ]; then
    ( cd "$SRC/$p" && git ls-files -s -z ) \
      | awk 'BEGIN{RS="\0"; ORS="\0"} $1 == "100755" { sub(/^[^\t]*\t/, ""); print }' \
      > /tmp/windows-import/exec-bits-$p.nul

    if [ -s /tmp/windows-import/exec-bits-$p.nul ]; then
      # File list is sent as data over stdin; the remote script only ever
      # reads argv/stdin, never has a filename spliced into its source text.
      ssh -i "$SSH_KEY" radek@192.168.122.99 \
        "python3 -c '
import sys, os, subprocess
base = sys.argv[1]
data = sys.stdin.buffer.read()
for rel in data.split(b\"\\0\"):
    if not rel:
        continue
    path = os.path.join(base.encode(), rel)
    if os.path.isfile(path):
        os.chmod(path, 0o700)
' '/home/radek/projects/.import-staging/$p'" \
        < /tmp/windows-import/exec-bits-$p.nul
    fi

    ssh -i "$SSH_KEY" radek@192.168.122.99 \
      "python3 -c '
import sys, os
hooks = sys.argv[1]
if os.path.isdir(hooks):
    os.chmod(hooks, 0o700)
    for name in os.listdir(hooks):
        if name.endswith(\".sample\"):
            continue
        p = os.path.join(hooks, name)
        if os.path.isfile(p):
            os.chmod(p, 0o700)
' '/home/radek/projects/.import-staging/$p/.git/hooks'"
  fi
```

- [ ] **Step 4: Atomic publish — rename staging directory into final place only if destination still absent (guards a TOCTOU race since Task 2's check)**

```bash
  echo "=== $p: publish ==="
  ssh -i "$SSH_KEY" radek@192.168.122.99 "
    set -e
    if [ -e '/home/radek/projects/$p' ]; then
      echo 'ABORT: destination now exists for $p, leaving staged copy in place for manual review' >&2
      exit 1
    fi
    mv '/home/radek/projects/.import-staging/$p' '/home/radek/projects/$p'
  "
  echo "=== $p: DONE ==="
}
```

- [ ] **Step 5: Drive the loop over the `import-list.json` entries, stopping on first failure (fail-fast, not skip-and-continue, so partial state is always inspectable), and write the exact published/skip/failed JSON manifests as we go**

```bash
mapfile -t IMPORT_LIST < <(python3 -c "import json; print('\n'.join(json.load(open('/tmp/windows-import/import-list.json'))['import']))")
PUBLISHED=()
FAILED=()
for p in "${IMPORT_LIST[@]}"; do
  if ( copy_project "$p" ); then
    PUBLISHED+=("$p")
  else
    FAILED+=("$p")
    echo "STOPPING: $p failed verification/publish"
    break
  fi
done

python3 -c "
import json
published = '''$(printf '%s\n' "${PUBLISHED[@]}")'''.splitlines()
failed = '''$(printf '%s\n' "${FAILED[@]}")'''.splitlines()
published = [x for x in published if x]
failed = [x for x in failed if x]
json.dump({'published': published}, open('/tmp/windows-import/published-list.json','w'), indent=2)
json.dump({'failed': failed}, open('/tmp/windows-import/failed-list.json','w'), indent=2)
print('published:', published)
print('failed:', failed)
"
```

- [ ] **Step 6: Leftover staging dirs are retained by default for manual review — this run never deletes a directory and contains no `rm -rf`**

```bash
# Report-only: lists any leftover .import-staging entries (from a project
# that failed verification/publish) so the operator can inspect them.
# Nothing here is removed; retention is the default outcome of a failed
# staging attempt.
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  for d in /home/radek/projects/.import-staging/*/; do
    [ -d "$d" ] || continue
    echo "RETAINED (not removed) incomplete staging dir: $d"
  done
'
```

- [ ] **Step 7 — OPERATOR CHECKPOINT:** Report `/tmp/windows-import/published-list.json`, `/tmp/windows-import/failed-list.json`, and `/tmp/windows-import/skip-list.json`. Do not proceed to Task 4 until the operator confirms which projects actually landed (`published-list.json`).

---

### Task 4: Registry mutation helper (TDD, local) — add published projects to `projects.json`

Written and tested entirely in this local repository checkout first. The helper imports the
*deployed* registry/lock modules by absolute path (not this repo's copy) so its behavior matches
production exactly; only the test target changes between local TDD and the real VM run.

**Files:**
- Create (local scratch, not committed): `/tmp/windows-import/import-projects-register.mjs`
- Create (local scratch, not committed): `/tmp/windows-import/import-projects-register.test.mjs`

**Interfaces:**
- Produces: `deriveProjectId(dirName)`, `buildProjectEntries(names, projectRoot)`,
  `loadPublishedNames(publishedListPath)` (the **sole** way project names ever enter this script —
  it reads and schema-validates `/tmp/windows-import/published-list.json`, the exact file produced
  and operator-confirmed in Task 3 Step 5/7; there is no shell-array/env-var name list anywhere in
  this plan, local or remote), `runImport(stateDir, projectRoot, publishedListPath)` (the testable
  core, returns `{ before, after, added, skipped }`), and a thin synchronous CLI entry guarded by
  `import.meta.url === pathToFileURL(process.argv[1]).href` (ESM entry-point check; no
  `require.main`) that reads `STATE_DIR`, `PROJECT_ROOT`, and `PUBLISHED_LIST_JSON_PATH` from argv
  and calls `runImport`, plus an explicit `--restore STATE_DIR BACKUP_PATH` CLI mode that calls
  `runRestore(stateDir, backupPath)`. `runImport` performs a single reentrant
  `withStateMaintenanceLock(stateDir, () => { ... })` call wrapping: load names from the JSON file →
  read registry → capture the before-set of `project_id`s → merge (skip existing ids, fail closed on
  id or derived-id collisions, **no mutation performed before this point**) → write → assert every
  before-set id is still present in the after-set (invariant check) → self-report `{before, after,
  added, skipped}` as JSON on stdout. `runRestore(stateDir, backupPath)` performs its own single
  `withStateMaintenanceLock(stateDir, () => { ... })` call wrapping: read + JSON-parse the validated
  backup file → `writeProjectRegistry(stateDir, backupDoc)` (the same atomic helper, never a raw
  `cp`/`mv`) → re-read the registry and assert it matches the parsed backup exactly → self-report
  `{restored: true}` as JSON on stdout. This is the sole exported rollback path Task 5 Step 8 invokes.
- Consumes (imported by absolute path from the real deployed checkout, never reimplemented):
  `readProjectRegistry`, `writeProjectRegistry`, `withStateMaintenanceLock`, `ProjectEntry`,
  `PROJECT_ID_PATTERN` from `/home/radek/autopilot-beta/src/data/delivery-system/projectRegistry.ts`
  and `/home/radek/autopilot-beta/src/data/delivery-system/stateMaintenanceLock.ts`. Locally, for the
  TDD pass in Steps 1–5, import instead from this repo's own `src/data/delivery-system/...` (same
  module contents, same checkout family) — Task 5 Step 2 is what repoints the import specifiers at
  the transferred `/home/radek/autopilot-beta` absolute paths for the real run.

- [ ] **Step 1: Write failing tests**

```js
// /tmp/windows-import/import-projects-register.test.mjs
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveProjectId,
  buildProjectEntries,
  loadPublishedNames,
  runImport,
  runRestore,
} from "./import-projects-register.mjs";
import {
  readProjectRegistry,
  writeProjectRegistry,
} from "/home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/src/data/delivery-system/projectRegistry.ts";

describe("deriveProjectId", () => {
  it("lowercases and maps invalid characters to hyphens", () => {
    expect(deriveProjectId("Crypto_Analyzer")).toBe("crypto_analyzer");
    expect(deriveProjectId("radeq-showcase-fable")).toBe("radeq-showcase-fable");
  });

  it("throws if the result still violates PROJECT_ID_PATTERN", () => {
    expect(() => deriveProjectId("")).toThrow("invalid_project_id");
  });
});

describe("buildProjectEntries", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "import-projects-register-"));
    mkdirSync(join(root, "Vzory"));
    mkdirSync(join(root, "radeq-showcase"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("builds enabled entries under the given project root", () => {
    const entries = buildProjectEntries(["Vzory"], root);
    expect(entries).toEqual([
      {
        schema_version: "v1",
        project_id: "vzory",
        name: "Vzory",
        cwd: realpathSync(join(root, "Vzory")),
        enabled: true,
      },
    ]);
  });

  it("fails closed on duplicate derived ids within the same batch", () => {
    mkdirSync(join(root, "Radeq Showcase"));
    expect(() => buildProjectEntries(["radeq-showcase", "Radeq Showcase"], root))
      .toThrow("duplicate_derived_project_id");
  });

  it("fails closed on duplicate input names within the same batch", () => {
    expect(() => buildProjectEntries(["Vzory", "Vzory"], root))
      .toThrow("duplicate_project_name");
  });

  it("fails closed if the destination does not actually exist on disk", () => {
    expect(() => buildProjectEntries(["does-not-exist-xyz"], root))
      .toThrow("destination_missing");
  });

  it("fails closed if the resolved realpath is not contained beneath the project root (symlink escape)", () => {
    const externalDir = mkdtempSync(join(tmpdir(), "outside-root-"));
    const linkPath = join(root, "escape-link");
    symlinkSync(externalDir, linkPath);
    try {
      expect(() => buildProjectEntries(["escape-link"], root))
        .toThrow("destination_outside_root");
    } finally {
      rmSync(externalDir, { recursive: true, force: true });
    }
  });
});

describe("loadPublishedNames", () => {
  let scratch;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "published-list-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("reads the published array from a valid manifest", () => {
    const p = join(scratch, "published-list.json");
    writeFileSync(p, JSON.stringify({ published: ["Vzory", "radeq-showcase"] }));
    expect(loadPublishedNames(p)).toEqual(["Vzory", "radeq-showcase"]);
  });

  it("fails closed on missing file", () => {
    expect(() => loadPublishedNames(join(scratch, "does-not-exist.json")))
      .toThrow("published_list_unreadable");
  });

  it("fails closed on invalid JSON", () => {
    const p = join(scratch, "published-list.json");
    writeFileSync(p, "not json");
    expect(() => loadPublishedNames(p)).toThrow("published_list_invalid_json");
  });

  it("fails closed when 'published' is missing, empty, or not an array of strings", () => {
    const p = join(scratch, "published-list.json");
    writeFileSync(p, JSON.stringify({}));
    expect(() => loadPublishedNames(p)).toThrow("published_list_malformed");
    writeFileSync(p, JSON.stringify({ published: [] }));
    expect(() => loadPublishedNames(p)).toThrow("published_list_malformed");
    writeFileSync(p, JSON.stringify({ published: [1, 2] }));
    expect(() => loadPublishedNames(p)).toThrow("published_list_malformed");
  });
});

describe("runImport", () => {
  let stateDir;
  let projectRoot;
  let scratch;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "import-state-"));
    projectRoot = mkdtempSync(join(tmpdir(), "import-root-"));
    scratch = mkdtempSync(join(tmpdir(), "import-scratch-"));
    mkdirSync(join(projectRoot, "Vzory"));
    mkdirSync(join(projectRoot, "radeq-showcase"));
    writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [
        {
          schema_version: "v1",
          project_id: "preexisting",
          name: "Preexisting",
          cwd: realpathSync(mkdtempSync(join(tmpdir(), "preexisting-"))),
          enabled: true,
        },
      ],
    });
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  function publishedListPath(names) {
    const p = join(scratch, "published-list.json");
    writeFileSync(p, JSON.stringify({ published: names }));
    return p;
  }

  it("merges new entries and never touches the preexisting entry (no-overwrite)", () => {
    const before = readProjectRegistry(stateDir);
    const result = runImport(stateDir, projectRoot, publishedListPath(["Vzory", "radeq-showcase"]));
    expect(result.added).toEqual(["vzory", "radeq-showcase"]);
    expect(result.skipped).toEqual([]);

    const after = readProjectRegistry(stateDir);
    const preexisting = after.projects.find((p) => p.project_id === "preexisting");
    expect(preexisting).toEqual(before.projects[0]);
    expect(after.projects).toHaveLength(3);
  });

  it("skips (does not duplicate or overwrite) an already-registered project_id", () => {
    runImport(stateDir, projectRoot, publishedListPath(["Vzory"]));
    const result = runImport(stateDir, projectRoot, publishedListPath(["Vzory"]));
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["vzory"]);
    const after = readProjectRegistry(stateDir);
    expect(after.projects.filter((p) => p.project_id === "vzory")).toHaveLength(1);
  });

  it("performs no mutation at all when the batch fails closed (e.g. duplicate derived id)", () => {
    mkdirSync(join(projectRoot, "Radeq Showcase"));
    const before = readProjectRegistry(stateDir);
    const beforeMtimeMs = statSync(join(stateDir, "projects.json")).mtimeMs;

    expect(() =>
      runImport(stateDir, projectRoot, publishedListPath(["radeq-showcase", "Radeq Showcase"]))
    ).toThrow("duplicate_derived_project_id");

    const after = readProjectRegistry(stateDir);
    expect(after).toEqual(before);
    expect(statSync(join(stateDir, "projects.json")).mtimeMs).toBe(beforeMtimeMs);
  });

  it("performs no mutation at all when the published-list manifest itself is malformed", () => {
    const before = readProjectRegistry(stateDir);
    const p = join(scratch, "published-list.json");
    writeFileSync(p, JSON.stringify({ published: [] }));

    expect(() => runImport(stateDir, projectRoot, p)).toThrow("published_list_malformed");

    const after = readProjectRegistry(stateDir);
    expect(after).toEqual(before);
  });
});

describe("runRestore", () => {
  let stateDir;
  let scratch;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "import-state-"));
    scratch = mkdtempSync(join(tmpdir(), "import-restore-scratch-"));
    writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [
        {
          schema_version: "v1",
          project_id: "preexisting",
          name: "Preexisting",
          cwd: realpathSync(mkdtempSync(join(tmpdir(), "preexisting-"))),
          enabled: true,
        },
      ],
    });
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it("loads a validated backup and writes it back atomically via writeProjectRegistry, re-reading to confirm the match", () => {
    const backupDoc = {
      schema_version: "v1",
      projects: [
        {
          schema_version: "v1",
          project_id: "restored-only",
          name: "Restored Only",
          cwd: realpathSync(mkdtempSync(join(tmpdir(), "restored-only-"))),
          enabled: true,
        },
      ],
    };
    const backupPath = join(scratch, "projects.json.pre-import-abc123456789.bak");
    writeFileSync(backupPath, JSON.stringify(backupDoc));

    const result = runRestore(stateDir, backupPath);
    expect(result).toEqual({ restored: true });

    const after = readProjectRegistry(stateDir);
    expect(after).toEqual(backupDoc);
  });

  it("fails closed on missing backup file, performing no write", () => {
    const before = readProjectRegistry(stateDir);
    const beforeMtimeMs = statSync(join(stateDir, "projects.json")).mtimeMs;

    expect(() => runRestore(stateDir, join(scratch, "does-not-exist.bak")))
      .toThrow("backup_unreadable");

    expect(readProjectRegistry(stateDir)).toEqual(before);
    expect(statSync(join(stateDir, "projects.json")).mtimeMs).toBe(beforeMtimeMs);
  });

  it("fails closed on invalid JSON in the backup file, performing no write", () => {
    const before = readProjectRegistry(stateDir);
    const backupPath = join(scratch, "projects.json.pre-import-bad.bak");
    writeFileSync(backupPath, "not json");

    expect(() => runRestore(stateDir, backupPath)).toThrow("backup_invalid_json");

    expect(readProjectRegistry(stateDir)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
npx vitest run /tmp/windows-import/import-projects-register.test.mjs
# Expected: FAIL, import-projects-register.mjs does not exist yet
```

- [ ] **Step 3: Implement the script** (local TDD target imports this repo's own module copy; the
  import specifiers are the only line Task 5 Step 2 changes for the real run)

```js
// /tmp/windows-import/import-projects-register.mjs
import { resolve, isAbsolute, relative, sep } from "node:path";
import { realpathSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  readProjectRegistry,
  writeProjectRegistry,
} from "/home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/src/data/delivery-system/projectRegistry.ts";
import { withStateMaintenanceLock } from "/home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/src/data/delivery-system/stateMaintenanceLock.ts";

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export function deriveProjectId(dirName) {
  const candidate = dirName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (!PROJECT_ID_PATTERN.test(candidate)) {
    throw new Error(`invalid_project_id: ${dirName}`);
  }
  return candidate;
}

export function buildProjectEntries(names, projectRoot) {
  const seenNames = new Set();
  const seenIds = new Set();
  const root = realpathSync(projectRoot);
  return names.map((name) => {
    if (seenNames.has(name)) {
      throw new Error(`duplicate_project_name: ${name}`);
    }
    seenNames.add(name);

    const project_id = deriveProjectId(name);
    if (seenIds.has(project_id)) {
      throw new Error(`duplicate_derived_project_id: ${project_id}`);
    }
    seenIds.add(project_id);

    const cwd = resolve(projectRoot, name);
    let realCwd;
    try {
      realCwd = realpathSync(cwd);
    } catch {
      throw new Error(`destination_missing: ${name}`);
    }
    const rel = relative(root, realCwd);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`destination_outside_root: ${name}`);
    }

    return {
      schema_version: "v1",
      project_id,
      name,
      cwd: realCwd,
      enabled: true,
    };
  });
}

// Sole entry point for project names into this script. There is no shell
// array, env var, or CLI-args list of names anywhere in this plan — the one
// source of truth is the operator-confirmed
// /tmp/windows-import/published-list.json from Task 3 Step 5/7.
export function loadPublishedNames(publishedListPath) {
  let raw;
  try {
    raw = readFileSync(publishedListPath, "utf8");
  } catch {
    throw new Error(`published_list_unreadable: ${publishedListPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`published_list_invalid_json: ${publishedListPath}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray(parsed.published) ||
    parsed.published.length === 0 ||
    !parsed.published.every((n) => typeof n === "string" && n.length > 0)
  ) {
    throw new Error(`published_list_malformed: ${publishedListPath}`);
  }
  return parsed.published;
}

export function runImport(stateDir, projectRoot, publishedListPath) {
  return withStateMaintenanceLock(stateDir, () => {
    // Everything up to and including buildProjectEntries only reads state;
    // the first write is writeProjectRegistry below. Any throw before that
    // line leaves projects.json byte-for-byte untouched.
    const names = loadPublishedNames(publishedListPath);
    const doc = readProjectRegistry(stateDir);
    const beforeIds = doc.projects.map((p) => p.project_id).sort();
    const existingIds = new Set(doc.projects.map((p) => p.project_id));
    const candidates = buildProjectEntries(names, projectRoot);

    const added = [];
    const skipped = [];
    const merged = [...doc.projects]; // preexisting entries are never dropped or edited
    for (const entry of candidates) {
      if (existingIds.has(entry.project_id)) {
        skipped.push(entry.project_id); // id collision: skip, do not overwrite
        continue;
      }
      merged.push(entry);
      added.push(entry.project_id);
    }

    writeProjectRegistry(stateDir, { ...doc, projects: merged });

    const afterIds = merged.map((p) => p.project_id).sort();
    for (const id of beforeIds) {
      if (!afterIds.includes(id)) {
        // Post-write invariant: every preexisting id must still be present.
        // A violation here means writeProjectRegistry itself misbehaved;
        // surfacing it distinctly from the pre-write fail-closed checks lets
        // the caller distinguish "no mutation happened" from "mutation
        // happened but violated an invariant" (Task 5 Step 4's rollback path
        // is for the latter).
        throw new Error(`invariant_violation_preexisting_entry_lost: ${id}`);
      }
    }

    const result = { before: beforeIds, after: afterIds, added, skipped };
    console.log(JSON.stringify(result));
    return result;
  });
}

// Explicit rollback path (Task 5 Step 8): re-reads the identity-pinned backup
// written in Task 5 Step 4, JSON-validates it, and writes it back through the
// same atomic writeProjectRegistry path the module already uses — never a raw
// cp/mv over the live file. Only ever invoked on a confirmed post-write
// verification failure, never speculatively.
export function runRestore(stateDir, backupPath) {
  return withStateMaintenanceLock(stateDir, () => {
    let raw;
    try {
      raw = readFileSync(backupPath, "utf8");
    } catch {
      throw new Error(`backup_unreadable: ${backupPath}`);
    }
    let backupDoc;
    try {
      backupDoc = JSON.parse(raw);
    } catch {
      throw new Error(`backup_invalid_json: ${backupPath}`);
    }

    writeProjectRegistry(stateDir, backupDoc);

    const after = readProjectRegistry(stateDir);
    if (JSON.stringify(after) !== JSON.stringify(backupDoc)) {
      throw new Error(`restore_mismatch: ${backupPath}`);
    }

    const result = { restored: true };
    console.log(JSON.stringify(result));
    return result;
  });
}

function main() {
  if (process.argv[2] === "--restore") {
    const stateDir = process.argv[3];
    const backupPath = process.argv[4];
    if (!stateDir || !isAbsolute(stateDir) || !backupPath || !isAbsolute(backupPath)) {
      console.error("usage: import-projects-register.mjs --restore STATE_DIR BACKUP_PATH");
      process.exit(1);
    }
    runRestore(stateDir, backupPath);
    return;
  }

  const stateDir = process.argv[2];
  const projectRoot = process.argv[3];
  const publishedListPath = process.argv[4];
  if (
    !stateDir || !isAbsolute(stateDir) ||
    !projectRoot || !isAbsolute(projectRoot) ||
    !publishedListPath || !isAbsolute(publishedListPath)
  ) {
    console.error("usage: import-projects-register.mjs STATE_DIR PROJECT_ROOT PUBLISHED_LIST_JSON_PATH");
    console.error("   or: import-projects-register.mjs --restore STATE_DIR BACKUP_PATH");
    process.exit(1);
  }
  runImport(stateDir, projectRoot, publishedListPath);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run and confirm GREEN**

```bash
npx vitest run /tmp/windows-import/import-projects-register.test.mjs
```

- [ ] **Step 5: Run full existing suite to confirm no regressions in the registry module's own tests**

```bash
npx vitest run tests/delivery-system/project-registry.test.ts
```

- [ ] **Step 6: Local dry run against a throwaway state dir to prove invalid input makes no mutation**

```bash
mkdir -p /tmp/windows-import/dry-state
chmod 700 /tmp/windows-import/dry-state
cat > /tmp/windows-import/dry-published-list.json <<'EOF'
{"published": ["radeq-showcase", "Radeq Showcase"]}
EOF
chmod 600 /tmp/windows-import/dry-published-list.json
npx --no-install tsx /tmp/windows-import/import-projects-register.mjs \
  /tmp/windows-import/dry-state /home/radek/projects /tmp/windows-import/dry-published-list.json \
  ; echo "exit=$? (expect nonzero, duplicate_derived_project_id, no projects.json written)"
ls /tmp/windows-import/dry-state/projects.json 2>/dev/null && echo "FAIL: file was written" || echo "OK: no file written"
```

---

### Task 5: Transfer the helper and apply the registry mutation on the VM, verify via authenticated HTTP

The helper never assumes a VM checkout of this `release-baseline-repair` worktree exists — it is
copied in directly as a standalone file into the private staging directory
`/home/radek/projects/.import-staging` and points its imports at the real deployed modules under
`/home/radek/autopilot-beta`.

- [ ] **Step 1 — OPERATOR CHECKPOINT:** Confirm the exact contents of
  `/tmp/windows-import/published-list.json` from Task 3 Step 5/7 one more time before mutating
  `projects.json`. This file — not any shell array, env var, or freshly-typed list — is the only
  input the helper will read for project names in Step 5 below.

- [ ] **Step 2: Repoint the two import specifiers at the deployed absolute paths, copy the helper and
  the operator-confirmed `published-list.json` into the private staging directory on the VM (not the
  destination project tree — neither file is a project and neither is ever published there), and
  checksum-verify the transferred manifest matches the local one byte-for-byte**

```bash
SSH_KEY=/home/radek/.ssh/autopilot-vm_ed25519
sed \
  -e 's#/home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/src/data/delivery-system/projectRegistry\.ts#/home/radek/autopilot-beta/src/data/delivery-system/projectRegistry.ts#' \
  -e 's#/home/radek/projects/autopilot-beta-worktrees/release-baseline-repair/src/data/delivery-system/stateMaintenanceLock\.ts#/home/radek/autopilot-beta/src/data/delivery-system/stateMaintenanceLock.ts#' \
  /tmp/windows-import/import-projects-register.mjs \
  > /tmp/windows-import/import-projects-register.deployed.mjs

ssh -i "$SSH_KEY" radek@192.168.122.99 'test -d /home/radek/autopilot-beta/src/data/delivery-system && echo OK: deployed modules dir present'

scp -i "$SSH_KEY" /tmp/windows-import/import-projects-register.deployed.mjs \
  radek@192.168.122.99:/home/radek/projects/.import-staging/import-projects-register.mjs
scp -i "$SSH_KEY" /tmp/windows-import/published-list.json \
  radek@192.168.122.99:/home/radek/projects/.import-staging/published-list.json

LOCAL_HASH=$(sha256sum /tmp/windows-import/published-list.json | cut -d' ' -f1)
REMOTE_HASH=$(ssh -i "$SSH_KEY" radek@192.168.122.99 \
  'sha256sum /home/radek/projects/.import-staging/published-list.json' | cut -d' ' -f1)
[ "$LOCAL_HASH" = "$REMOTE_HASH" ] \
  && echo "OK: published-list.json transferred identically" \
  || { echo "MISMATCH transferring published-list.json, ABORT"; exit 1; }
```

- [ ] **Step 3: On the VM, confirm the Node runtime, service, and port before mutating, and securely
  source the control-plane environment file without ever printing it**

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -e
  test "$(command -v node)" = /usr/bin/node
  /usr/bin/node --version | grep -q "^v24\." && echo "OK: node v24 at /usr/bin/node"
  systemctl is-active autopilot-control-plane.service
  systemctl show autopilot-control-plane.service -p ExecStart | grep -q " 8787" && echo "OK: port 8787"
  set -a
  source ~/.config/autopilot/control-plane.env
  set +a
  test -n "$CONTROL_PLANE_TOKEN" && echo "OK: token present (not printed)"
'
```

- [ ] **Step 4: Identity-pinned bounded backup of `projects.json`, fail-closed validated, before
  mutation** (a hash-named backup that already exists from a prior run is only *validated*, never
  overwritten — `cp` never runs a second time over the same identity-pinned path)

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -e
  STATE_DIR=/home/radek/.local/state/autopilot
  mkdir -p "$STATE_DIR/backups"
  chmod 700 "$STATE_DIR/backups"
  HASH=$(sha256sum "$STATE_DIR/projects.json" | cut -c1-12)
  BACKUP="$STATE_DIR/backups/projects.json.pre-import-$HASH.bak"

  if [ -e "$BACKUP" ]; then
    echo "backup already exists at this identity-pinned path, validating only (no overwrite): $BACKUP"
  else
    cp --no-dereference "$STATE_DIR/projects.json" "$BACKUP"
    chmod 600 "$BACKUP"
  fi

  # Fail-closed: must be a regular file, not a symlink, mode exactly 600.
  [ -L "$BACKUP" ] && { echo "BACKUP IS A SYMLINK, ABORT: $BACKUP"; exit 1; }
  [ -f "$BACKUP" ] || { echo "BACKUP IS NOT A REGULAR FILE, ABORT: $BACKUP"; exit 1; }
  MODE=$(stat -c %a "$BACKUP")
  [ "$MODE" = "600" ] || { echo "BACKUP MODE IS $MODE, EXPECTED 600, ABORT: $BACKUP"; exit 1; }

  A=$(sha256sum "$STATE_DIR/projects.json" | cut -d" " -f1)
  B=$(sha256sum "$BACKUP" | cut -d" " -f1)
  [ "$A" = "$B" ] && echo "OK: backup validated identical: $BACKUP" || { echo "BACKUP MISMATCH, ABORT"; exit 1; }

  # Record the exact backup path for Step 8/rollback — never re-derived, never guessed.
  echo "$BACKUP" > "$STATE_DIR/backups/.last-pre-import-backup-path"
  chmod 600 "$STATE_DIR/backups/.last-pre-import-backup-path"
'
```

- [ ] **Step 5: Run the helper against the real state dir and the real deployed project root, passing
  only the path to the staged, checksum-verified `published-list.json` from Step 2 — no shell array,
  no `argv` name list, no interpolation of project names into the remote command string at all**

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -a; source ~/.config/autopilot/control-plane.env; set +a
  cd /home/radek/autopilot-beta && npx --no-install tsx /home/radek/projects/.import-staging/import-projects-register.mjs \
    /home/radek/.local/state/autopilot /home/radek/projects \
    /home/radek/projects/.import-staging/published-list.json
'
```

- [ ] **Step 6: Verify `/ready` without any auth (health only), port always the confirmed literal
  `8787`**

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 'curl -sf http://127.0.0.1:8787/ready'
```

- [ ] **Step 7: Verify `/projects` through authenticated localhost, token read from the sourced env,
  never printed**

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -a; source ~/.config/autopilot/control-plane.env; set +a
  curl -sf -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" http://127.0.0.1:8787/projects \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print([p[\"project_id\"] for p in d])"
'
# Never `echo $CONTROL_PLANE_TOKEN` or include it in any log; the curl -H substitution happens
# inside the remote shell's own environment, not printed by this command.
```

- [ ] **Step 8: Confirm every project_id derived (per Task 3's `deriveProjectId` table) from the names
  in `/tmp/windows-import/published-list.json` appears in the printed `/projects` list, and every
  preexisting entry is still present** (compare against a `/projects` snapshot taken the same way
  *before* Step 5 — the same before/after invariant Task 4's `runImport` already checks locally).

  Only if this comparison shows a confirmed post-write HTTP/invariant failure (never speculatively),
  run the exact rollback below, using the exact backup path recorded by Step 4 — never a raw `cp`/`mv`
  over the live file:

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -e
  STATE_DIR=/home/radek/.local/state/autopilot
  BACKUP=$(cat "$STATE_DIR/backups/.last-pre-import-backup-path")
  cd /home/radek/autopilot-beta && npx --no-install tsx \
    /home/radek/projects/.import-staging/import-projects-register.mjs \
    --restore "$STATE_DIR" "$BACKUP"
'
```

  Then re-verify `/projects` shows exactly the pre-import set (the same project_id set captured in
  the pre-Step-5 snapshot) before reporting failure to the operator:

```bash
ssh -i "$SSH_KEY" radek@192.168.122.99 '
  set -a; source ~/.config/autopilot/control-plane.env; set +a
  curl -sf -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" http://127.0.0.1:8787/projects \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print([p[\"project_id\"] for p in d])"
'
```

- [ ] **Step 9 — OPERATOR CHECKPOINT:** Present the final diff (before/after `/projects` project_id
  sets, published vs. skipped vs. failed project list, backup path) to the operator for sign-off.
  This closes the import.

---

### Task 6: Record the known follow-up blocker (no code/config change)

- [ ] **Step 1:** Note explicitly for the operator: importing these 18 projects into `projects.json` makes them *visible* to the control plane (`/projects`, readiness), but each project still needs its own **provider bridge** wiring — i.e., whatever mechanism maps a `project_id` to an actual runnable provider/agent configuration for governed runs — before any run can actually be dispatched against it. This plan intentionally does not implement that; it is a distinct, separate piece of work to scope after this import is verified. Flag it as open in the handoff summary rather than silently leaving it implied.
