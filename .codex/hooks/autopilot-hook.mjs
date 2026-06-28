import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  promises as fsPromises,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_VERSION = 1;
const MAX_LEDGER_ENTRIES = 200;
const MAX_LEDGER_BYTES = 256 * 1024;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..", "..");
const STATE_DIRECTORY =
  process.env.AUTOPILOT_HOOK_STATE_DIR || join(REPOSITORY_ROOT, ".codex", "state");
const LEDGER_PATH = join(STATE_DIRECTORY, "events.jsonl");
const CONTINUITY_PATH = join(STATE_DIRECTORY, "continuity.json");
const INVESTIGATION_QUEUE_PATH = join(STATE_DIRECTORY, "investigation-queue.jsonl");
const SESSION_STATE_DIRECTORY =
  process.env.AUTOPILOT_SESSION_STATE_DIR ||
  join(REPOSITORY_ROOT, "docs", "autopilot", "session-state");
const SESSION_STATE_PATH = join(SESSION_STATE_DIRECTORY, "session.json");
const SESSION_HISTORY_PATH = join(SESSION_STATE_DIRECTORY, "history.jsonl");
const SESSION_LOCK_PATH = join(SESSION_STATE_DIRECTORY, "worker.lock");
const AGENT_REGISTRY_PATH = join(SESSION_STATE_DIRECTORY, "agent-registry.jsonl");
const HISTORY_MAX_ENTRIES = 50;
const SESSION_WRITE_TIMEOUT_MS = 200;
const WORKER_LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const GEMINI_RATE_LIMIT_PHRASES = [
  "You have exhausted your capacity on this model.",
  "quota",
  "rate limit",
  "resource_exhausted",
  "RESOURCE_EXHAUSTED",
  "quota retry",
  "retry",
  "429"
];

const REQUIRED_CONTROL_PLANE_PATHS = [
  "AGENTS.md",
  "mesh",
  "docs/projects/autopilot-control-plane/architecture.md",
  "docs/projects/autopilot-control-plane/work-log.md",
  "docs/projects/autopilot-control-plane/decision-mesh"
];

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[a-z0-9_-]{20,}\b/i,
  /\bgh[pousr]_[a-z0-9]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{25,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[a-z0-9_./+=-]{16,}/i
];

const SUPERVISOR_ALERT_SEVERITY = {
  provider_rate_limited: "warning",
  provider_tier_switched: "info",
  provider_unavailable: "blocker",
  correction_loop_exceeded: "blocker",
  stuck_workflow_state: "warning",
  eval_score_below_threshold: "warning",
  missing_owner_decision: "blocker",
  gemini_session_exhausted: "warning",
  reuse_check_skipped: "info",
  skill_replacement_available: "info"
};

const SUPERVISOR_ALERT_RECOMMENDED_ACTION = {
  provider_rate_limited: "Record the capacity event and wait or choose an approved fallback tier.",
  provider_tier_switched: "Record the provider tier change in the session state.",
  provider_unavailable: "Stop dependent work and mark the provider path as blocked or waiting_owner.",
  correction_loop_exceeded: "Stop correction attempts and request supervisor review.",
  stuck_workflow_state: "Review the workflow state and define the next explicit transition.",
  eval_score_below_threshold: "Route the output through review before reuse.",
  missing_owner_decision: "Wait for the required owner decision before continuing.",
  gemini_session_exhausted: "Record the exhausted Gemini session and consider an approved Gemini fallback tier.",
  reuse_check_skipped: "Run the reuse check before assigning bounded implementation.",
  skill_replacement_available: "Review the replacement candidate before continuing with the older skill."
};

const RISK_PATTERNS = {
  destructive_command: [
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-[a-z]*f/i,
    /\brm\s+-rf\b/i,
    /\bRemove-Item\b[\s\S]*\b-Recurse\b/i,
    /\bdel\s+\/[sq]\b/i,
    /\bformat\s+[a-z]:/i,
    /\bDROP\s+(?:DATABASE|TABLE)\b/i,
    /\bTRUNCATE\s+TABLE\b/i
  ],
  remote_mutation: [
    /\bgit\s+push\b/i,
    /\bgh\s+(?:api|issue|pr|release|repo|workflow)\b[\s\S]*\b(?:close|create|delete|edit|merge|run)\b/i,
    /\bwrangler\s+(?:deploy|publish|d1\s+execute)\b/i,
    /\bvercel\b[\s\S]*(?:--prod|\bdeploy\b)/i,
    /\bnpm\s+publish\b/i,
    /\bdocker\s+push\b/i,
    /\bcurl\b[\s\S]*\b(?:POST|PUT|PATCH|DELETE)\b/i
  ],
  deployment_or_production: [
    /\b(?:deploy|deployment|production|publish|promote|rollback)\b/i,
    /\b(?:wrangler|vercel|cloudflare|github actions)\b/i
  ],
  credential_surface: [
    /(?:^|[\\/])\.env(?:[./\\]|$)/i,
    /(?:credential|private[_-]?key|secret|token)/i,
    /(?:^|[\\/])\.codex[\\/](?:auth|credential)/i
  ],
  governance_surface: [
    /(?:^|[\\/])AGENTS\.md\b/i,
    /(?:^|[\\/])mesh[\\/]/i,
    /(?:^|[\\/])mcp[\\/]/i,
    /(?:^|[\\/])docs[\\/]projects[\\/]/i,
    /(?:^|[\\/])\.codex[\\/]hooks/i
  ],
  external_model_or_api: [
    /\b(?:gemini|claude|openai)\b[\s\S]*(?:cli|api|prompt|model)/i,
    /\bcurl\b[\s\S]*https?:\/\//i
  ]
};

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function toJsonText(value, limit = 24_000) {
  try {
    const text = JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return "";
  }
}

function collectFlags(text) {
  const flags = [];

  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    flags.push("secret_like_input");
  }

  for (const [flag, patterns] of Object.entries(RISK_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) {
      flags.push(flag);
    }
  }

  return flags;
}

function classifyScope(cwd) {
  if (!cwd || !isAbsolute(cwd)) {
    return "unknown";
  }

  const pathFromRoot = relative(REPOSITORY_ROOT, resolve(cwd));
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
    ? "autopilot_control_plane"
    : "external_or_supervised_project";
}

function getToolText(input) {
  const toolInput = input.tool_input;

  if (toolInput && typeof toolInput === "object" && typeof toolInput.command === "string") {
    return toolInput.command;
  }

  return toJsonText(toolInput);
}

function responseLooksFailed(response) {
  if (!response || typeof response !== "object") {
    return false;
  }

  if (response.isError === true || response.ok === false) {
    return true;
  }

  for (const field of ["exit_code", "exitCode"]) {
    if (typeof response[field] === "number" && response[field] !== 0) {
      return true;
    }
  }

  if (typeof response.statusCode === "number" && response.statusCode >= 400) {
    return true;
  }

  const text = toJsonText(response, 8_000);
  return /(?:exit code|process exited with code)\s*[:=]?\s*[1-9]\d*/i.test(text);
}

function classifyFailure(response) {
  if (!response || typeof response !== "object") {
    return { failure_type: "unknown_failure" };
  }

  if (response.isError === true || response.ok === false) {
    return { failure_type: "tool_error_flag" };
  }

  for (const field of ["exit_code", "exitCode"]) {
    if (typeof response[field] === "number" && response[field] !== 0) {
      return { failure_type: "nonzero_exit_code", exit_code: response[field] };
    }
  }

  if (typeof response.statusCode === "number" && response.statusCode >= 400) {
    return { failure_type: "http_error_status", status_code: response.statusCode };
  }

  const text = toJsonText(response, 8_000);
  const exitCodeMatch = text.match(/(?:exit code|process exited with code)\s*[:=]?\s*([1-9]\d*)/i);
  if (exitCodeMatch) {
    return { failure_type: "text_reported_exit_code", exit_code: Number(exitCodeMatch[1]) };
  }

  return { failure_type: "unknown_failure" };
}

function eventRecord(input, flags = [], result = "observed") {
  const inputFingerprint =
    input.hook_event_name === "UserPromptSubmit"
      ? hash(input.prompt)
      : hash(getToolText(input) || input.last_assistant_message || input.trigger || input.source);

  return {
    version: HOOK_VERSION,
    timestamp: new Date().toISOString(),
    event: String(input.hook_event_name || "Unknown"),
    scope: classifyScope(input.cwd),
    session: hash(input.session_id),
    turn: hash(input.turn_id),
    tool: typeof input.tool_name === "string" ? input.tool_name : null,
    flags: [...new Set(flags)].sort(),
    result,
    input_fingerprint: inputFingerprint
  };
}

function investigationRecord(input, flags = []) {
  const failure = classifyFailure(input.tool_response);
  return {
    version: HOOK_VERSION,
    timestamp: new Date().toISOString(),
    status: "ready",
    source: "codex_hook_post_tool_use",
    target_agent: "investigator",
    mode: "INSPECT_ONLY",
    scope: classifyScope(input.cwd),
    session: hash(input.session_id),
    turn: hash(input.turn_id),
    tool: typeof input.tool_name === "string" ? input.tool_name : null,
    flags: [...new Set(flags)].sort(),
    ...failure,
    input_fingerprint: hash(getToolText(input)),
    response_fingerprint: hash(toJsonText(input.tool_response, 8_000)),
    required_checks: [
      "classify_autopilot_vs_project_boundary",
      "inspect_failure_without_raw_log_copy",
      "reproduce_or_record_failure_pointer",
      "rerun_narrowest_relevant_check",
      "identify_affected_running_process",
      "checkpoint_progress_before_fix",
      "stop_or_drain_affected_process_before_fix",
      "apply_fix_only_after_process_stopped_or_drained",
      "restart_refreshed_session_after_fix",
      "update_continuity_and_resume_from_last_state",
      "summarize_redacted_root_cause",
      "report_owner_or_external_dependency"
    ],
    forbidden_actions: [
      "remote_mutation",
      "raw_prompt_or_response_storage",
      "raw_project_log_copy",
      "secret_or_pii_disclosure",
      "fixing_live_process_without_stop_or_drain",
      "continuing_after_restart_without_state_update",
      "delivery_approval"
    ],
    expected_output: "redacted_failure_summary_with_reproduction_or_blocker"
  };
}

function ensureStateDirectory() {
  mkdirSync(STATE_DIRECTORY, { recursive: true });
}

function trimJsonlIfNeeded(path) {
  if (!existsSync(path) || statSync(path).size <= MAX_LEDGER_BYTES) {
    return;
  }

  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-MAX_LEDGER_ENTRIES);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${hash(Math.random())}.tmp`;
  writeFileSync(temporaryPath, `${lines.join("\n")}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function trimLedgerIfNeeded() {
  trimJsonlIfNeeded(LEDGER_PATH);
}

function record(input, flags = [], result = "observed") {
  try {
    ensureStateDirectory();
    appendFileSync(LEDGER_PATH, `${JSON.stringify(eventRecord(input, flags, result))}\n`, "utf8");
    trimLedgerIfNeeded();
    return true;
  } catch {
    return false;
  }
}

function recordInvestigation(input, flags = []) {
  try {
    ensureStateDirectory();
    appendFileSync(
      INVESTIGATION_QUEUE_PATH,
      `${JSON.stringify(investigationRecord(input, flags))}\n`,
      "utf8"
    );
    trimJsonlIfNeeded(INVESTIGATION_QUEUE_PATH);
    return true;
  } catch {
    return false;
  }
}

function readRecentTurnEvents(input) {
  try {
    if (!existsSync(LEDGER_PATH)) {
      return [];
    }

    const turn = hash(input.turn_id);
    return readFileSync(LEDGER_PATH, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-MAX_LEDGER_ENTRIES)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.turn === turn);
  } catch {
    return [];
  }
}

function writeContinuity(input) {
  try {
    ensureStateDirectory();
    const recentEvents = readRecentTurnEvents(input);
    const flags = [...new Set(recentEvents.flatMap((entry) => entry.flags || []))].sort();
    const payload = {
      version: HOOK_VERSION,
      updated_at: new Date().toISOString(),
      session: hash(input.session_id),
      turn: hash(input.turn_id),
      trigger: input.trigger || null,
      scope: classifyScope(input.cwd),
      recent_event_count: recentEvents.length,
      recent_flags: flags,
      required_sources: [
        "AGENTS.md",
        "Decision Mesh packet",
        "project architecture and work log",
        "local verification evidence"
      ]
    };
    const temporaryPath = `${CONTINUITY_PATH}.${process.pid}.${Date.now()}.${hash(Math.random())}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, CONTINUITY_PATH);
    return true;
  } catch {
    return false;
  }
}

function detectGeminiCapacityPhrase(toolName, resultText) {
  if (typeof toolName !== "string" || !toolName.toLowerCase().includes("gemini")) {
    return false;
  }

  const lower = String(resultText || "").toLowerCase();
  return GEMINI_RATE_LIMIT_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()));
}

function getHandoffId(input) {
  if (typeof input.handoff_id === "string") {
    return input.handoff_id;
  }

  if (typeof input.handoffId === "string") {
    return input.handoffId;
  }

  return undefined;
}

function getAgentId(input) {
  if (typeof input.agent_id === "string") {
    return input.agent_id;
  }

  if (typeof input.agentId === "string") {
    return input.agentId;
  }

  return undefined;
}

function getAgentType(input) {
  if (typeof input.agent_type === "string") {
    return input.agent_type;
  }

  if (typeof input.agentType === "string") {
    return input.agentType;
  }

  return null;
}

function createSessionHistoryEntry(event, detail, handoffId = null) {
  return {
    timestamp: new Date().toISOString(),
    event,
    handoffId: handoffId ?? null,
    detail
  };
}

function createInitialSessionManifest() {
  const now = new Date().toISOString();
  return {
    schemaVersion: "v1",
    claudeSessionStartedAt: now,
    lastUpdatedAt: now,
    activeHandoffId: null,
    workflowState: "planning",
    pendingAlerts: [],
    activeCorrectionLoopCount: 0,
    providerStatus: {},
    hookEventCount: 0,
    investigationQueueDepth: 0,
    supervisorSessionHash: null
  };
}

function normalizeSessionManifest(value) {
  const base = createInitialSessionManifest();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return base;
  }

  return {
    ...base,
    ...value,
    schemaVersion: "v1",
    activeHandoffId: typeof value.activeHandoffId === "string" ? value.activeHandoffId : null,
    pendingAlerts: Array.isArray(value.pendingAlerts) ? value.pendingAlerts : [],
    providerStatus:
      value.providerStatus && typeof value.providerStatus === "object" && !Array.isArray(value.providerStatus)
        ? value.providerStatus
        : {},
    workflowState: typeof value.workflowState === "string" ? value.workflowState : base.workflowState,
    supervisorSessionHash:
      typeof value.supervisorSessionHash === "string" ? value.supervisorSessionHash : null
  };
}

function createSupervisorAlert(trigger, context, provider = null) {
  return {
    id: `alert-${trigger.replaceAll("_", "-")}-${Date.now()}-${hash(context)}`,
    trigger,
    severity: SUPERVISOR_ALERT_SEVERITY[trigger] || "warning",
    provider,
    context,
    recommendedAction:
      SUPERVISOR_ALERT_RECOMMENDED_ACTION[trigger] ||
      "Review this supervisor alert before continuing.",
    createdAt: new Date().toISOString(),
    resolved: false,
    resolvedAt: null
  };
}

function countJsonlLines(path) {
  try {
    if (!existsSync(path)) {
      return 0;
    }

    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function ensureSessionStateDirectory() {
  await fsPromises.mkdir(SESSION_STATE_DIRECTORY, { recursive: true });
}

function readSupervisorSessionHash() {
  try {
    if (!existsSync(SESSION_STATE_PATH)) {
      return null;
    }

    const session = normalizeSessionManifest(JSON.parse(readFileSync(SESSION_STATE_PATH, "utf8")));
    return typeof session.supervisorSessionHash === "string" ? session.supervisorSessionHash : null;
  } catch {
    return null;
  }
}

function appendAgentRegistryEntry(entry) {
  try {
    mkdirSync(SESSION_STATE_DIRECTORY, { recursive: true });
    appendFileSync(AGENT_REGISTRY_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    trimJsonlIfNeeded(AGENT_REGISTRY_PATH);
    return true;
  } catch {
    return false;
  }
}

function recordSubagentStart(input) {
  return appendAgentRegistryEntry({
    schema_version: "v1",
    event: "subagent_start",
    agent_id: getAgentId(input) ?? null,
    agent_type: getAgentType(input),
    parent_session_hash: readSupervisorSessionHash(),
    parent_turn_hash: hash(input.turn_id ?? ""),
    started_at: new Date().toISOString()
  });
}

function recordSubagentStop(input) {
  return appendAgentRegistryEntry({
    schema_version: "v1",
    event: "subagent_stop",
    agent_id: getAgentId(input) ?? null,
    stopped_at: new Date().toISOString()
  });
}

async function trimAndAppendHistory(entry) {
  try {
    await ensureSessionStateDirectory();
    let lines = [];

    try {
      lines = (await fsPromises.readFile(SESSION_HISTORY_PATH, "utf8")).split(/\r?\n/).filter(Boolean);
    } catch {
      lines = [];
    }

    lines = lines.slice(-(HISTORY_MAX_ENTRIES - 1));
    lines.push(JSON.stringify(entry));
    await fsPromises.writeFile(SESSION_HISTORY_PATH, `${lines.join("\n")}\n`, "utf8");
  } catch {
    // Session-state writes are advisory and must never block Codex hooks.
  }
}

async function doSessionWrite(updateFn, signal) {
  await ensureSessionStateDirectory();
  let current = createInitialSessionManifest();

  try {
    current = normalizeSessionManifest(JSON.parse(await fsPromises.readFile(SESSION_STATE_PATH, { encoding: "utf8", signal })));
  } catch {
    current = createInitialSessionManifest();
  }

  const next = normalizeSessionManifest(updateFn(current) || current);
  const temporaryPath = `${SESSION_STATE_PATH}.${process.pid}.${Date.now()}.${hash(Math.random())}.tmp`;

  try {
    signal?.throwIfAborted?.();
    await fsPromises.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", signal });
    signal?.throwIfAborted?.();
    await fsPromises.rename(temporaryPath, SESSION_STATE_PATH);
  } catch (error) {
    try {
      await fsPromises.unlink(temporaryPath);
    } catch {
      // Ignore cleanup failure for advisory session-state writes.
    }
    throw error;
  }
}

async function writeSessionJsonSafe(updateFn) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_WRITE_TIMEOUT_MS);

  try {
    await doSessionWrite(updateFn, controller.signal);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getWorkerLockTimestamp(lock, stats) {
  if (lock && typeof lock === "object" && typeof lock.lockedAt === "string") {
    const lockedAt = Date.parse(lock.lockedAt);
    if (Number.isFinite(lockedAt)) {
      return lockedAt;
    }
  }

  return stats.mtimeMs;
}

async function removeStaleWorkerLock() {
  try {
    const stats = await fsPromises.stat(SESSION_LOCK_PATH);
    let lock = null;

    try {
      lock = JSON.parse(await fsPromises.readFile(SESSION_LOCK_PATH, "utf8"));
    } catch {
      lock = null;
    }

    const lockTimestamp = getWorkerLockTimestamp(lock, stats);
    if (Date.now() - lockTimestamp <= WORKER_LOCK_STALE_MS) {
      return false;
    }

    await fsPromises.unlink(SESSION_LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

async function createWorkerLock(input, allowStaleReplacement = true) {
  try {
    const agentId = getAgentId(input);
    if (!agentId) {
      return "missing_agent_id";
    }

    await ensureSessionStateDirectory();
    let fileHandle;

    try {
      fileHandle = await fsPromises.open(SESSION_LOCK_PATH, "wx");
      await fileHandle.writeFile(
        `${JSON.stringify({ lockedBy: agentId, lockedAt: new Date().toISOString() })}\n`,
        "utf8"
      );
      return "acquired";
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        if (allowStaleReplacement && (await removeStaleWorkerLock())) {
          const retryStatus = await createWorkerLock(input, false);
          return retryStatus === "acquired" ? "stale_replaced" : retryStatus;
        }

        return "already_locked";
      }

      return "failed";
    } finally {
      if (fileHandle) {
        try {
          await fileHandle.close();
        } catch {
          // Ignore close failure for advisory lock writes.
        }
      }
    }
  } catch {
    // Lock writes are advisory and must never block hook execution.
    return "failed";
  }
}

async function releaseWorkerLock(input) {
  try {
    const agentId = getAgentId(input);
    if (!agentId) {
      return;
    }

    const lock = JSON.parse(await fsPromises.readFile(SESSION_LOCK_PATH, "utf8"));
    if (lock?.lockedBy === agentId) {
      await fsPromises.unlink(SESSION_LOCK_PATH);
    }
  } catch {
    // Lock release is advisory and must never block hook execution.
  }
}

function additionalContext(eventName, messages, systemMessage) {
  const response = {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: messages.join(" ")
    }
  };

  if (systemMessage) {
    response.systemMessage = systemMessage;
  }

  return response;
}

function riskMessages(flags, scope) {
  const messages = [];

  if (flags.includes("secret_like_input") || flags.includes("credential_surface")) {
    messages.push(
      "Potential credential or secret material is present. Do not print, persist, or send it to external tools; redact and verify the intended surface."
    );
  }

  if (flags.includes("destructive_command")) {
    messages.push(
      "Potential destructive operation detected. Confirm the exact resolved target, backup or rollback, and explicit owner scope before execution."
    );
  }

  if (flags.includes("remote_mutation")) {
    messages.push(
      "Potential remote mutation detected. Require explicit REMOTE_MUTATION_APPROVED scope and work-log evidence before treating it as authorized."
    );
  }

  if (flags.includes("deployment_or_production")) {
    messages.push(
      "Deployment or production behavior may be affected. Verify the current project architecture, environment, rollback path, and delivery approval."
    );
  }

  if (flags.includes("external_model_or_api")) {
    messages.push(
      "External model or API use may be involved. Verify availability and no-cost status, redact private context, and keep model output advisory until locally verified."
    );
  }

  if (flags.includes("governance_surface")) {
    messages.push(
      "Autopilot governance files may change. Record architecture, project-mesh, and work-log impact after verification."
    );
  }

  if (scope === "external_or_supervised_project") {
    messages.push(
      "The active working directory is outside the Autopilot control plane. Classify the supervised project and load its project-specific mesh before implementation."
    );
  }

  return messages;
}

async function handleSessionStart(input) {
  const missing = REQUIRED_CONTROL_PLANE_PATHS.filter(
    (path) => !existsSync(join(REPOSITORY_ROOT, path))
  );
  const messages = [
    "Autopilot Codex hooks are active in report-first mode.",
    "Before planning or editing, follow AGENTS.md, use the smallest relevant Decision Mesh packet, and keep supervised-project runtime evidence in that project."
  ];

  if (missing.length > 0) {
    messages.push(`Required control-plane sources are missing: ${missing.join(", ")}.`);
  }

  const recorded = record(input, missing.length > 0 ? ["missing_control_plane_source"] : []);
  if (!recorded) {
    messages.push("The local redacted hook ledger is unavailable; do not claim hook evidence.");
  }

  await writeSessionJsonSafe((state) => ({
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    supervisorSessionHash: state.supervisorSessionHash ?? hash(input.session_id ?? ""),
    hookEventCount: countJsonlLines(LEDGER_PATH),
    investigationQueueDepth: countJsonlLines(INVESTIGATION_QUEUE_PATH)
  }));

  return additionalContext(
    "SessionStart",
    messages,
    missing.length > 0 ? "Autopilot startup guardrail found missing control-plane sources." : undefined
  );
}

async function handleSubagentStart(input) {
  const messages = [
    "Treat subagent output as a bounded draft.",
    "Do not approve architecture, security, business scope, remote mutation, or delivery.",
    "Return verification evidence, risks, and source pointers for orchestrator review."
  ];
  record(input);
  const lockStatus = await createWorkerLock(input);
  recordSubagentStart(input);
  if (lockStatus === "already_locked") {
    messages.push("worker.lock already present; previous worker session may still be active.");
  } else if (lockStatus === "stale_replaced") {
    messages.push("stale worker.lock was replaced for this agent; record the previous worker as abandoned before relying on serial enforcement.");
  } else if (lockStatus === "missing_agent_id") {
    messages.push("worker.lock was not created because agent_id is missing; do not claim serial worker enforcement.");
  } else if (lockStatus === "failed") {
    messages.push("worker.lock could not be created; do not claim serial worker enforcement.");
  }
  return additionalContext("SubagentStart", messages);
}

function handleUserPromptSubmit(input) {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const flags = collectFlags(prompt);
  const scope = classifyScope(input.cwd);
  const messages = riskMessages(flags, scope);

  if (/\b(?:latest|current|newest|best practices?|context7)\b/i.test(prompt)) {
    flags.push("currentness_verification_needed");
    messages.push(
      "Currentness-sensitive guidance is requested. Verify it through Context7 when available or official documentation before adoption."
    );
  }

  const recorded = record(input, flags);
  if (!recorded) {
    messages.push("The local redacted hook ledger is unavailable; do not claim hook evidence.");
  }

  return messages.length > 0
    ? additionalContext(
        "UserPromptSubmit",
        messages,
        flags.includes("secret_like_input")
          ? "Autopilot hook detected possible sensitive prompt content."
          : undefined
      )
    : null;
}

function handlePreToolUse(input) {
  const flags = collectFlags(getToolText(input));
  const scope = classifyScope(input.cwd);
  const messages = riskMessages(flags, scope);
  const recorded = record(input, flags);

  if (!recorded) {
    messages.push("The local redacted hook ledger is unavailable; do not claim hook evidence.");
  }

  return messages.length > 0
    ? additionalContext(
        "PreToolUse",
        messages,
        flags.some((flag) =>
          ["destructive_command", "remote_mutation", "secret_like_input"].includes(flag)
        )
          ? "Autopilot report-only hook detected a high-risk tool surface."
          : undefined
      )
    : null;
}

async function handlePostToolUse(input) {
  const flags = collectFlags(getToolText(input));
  const failed = responseLooksFailed(input.tool_response);
  const geminiCapacityDetected = detectGeminiCapacityPhrase(
    input.tool_name,
    `${toJsonText(input.result, 8_000)} ${toJsonText(input.tool_response, 8_000)}`
  );

  if (failed) {
    flags.push("tool_result_failed");
  }

  if (geminiCapacityDetected) {
    flags.push("gemini_session_exhausted");
    await trimAndAppendHistory(
      createSessionHistoryEntry("provider_status_changed", "gemini_rate_limit_phrase_detected", getHandoffId(input))
    );
    await writeSessionJsonSafe((state) => ({
      ...state,
      lastUpdatedAt: new Date().toISOString(),
      providerStatus: {
        ...state.providerStatus,
        gemini_cli: "rate_limited"
      },
      pendingAlerts: [
        ...state.pendingAlerts,
        createSupervisorAlert("gemini_session_exhausted", "gemini_rate_limit_phrase_detected", "gemini_cli")
      ],
      hookEventCount: countJsonlLines(LEDGER_PATH),
      investigationQueueDepth: countJsonlLines(INVESTIGATION_QUEUE_PATH)
    }));
  }

  const messages = [];
  if (failed) {
    messages.push(
      "The tool result appears unsuccessful. Do not treat it as verification evidence; inspect the failure and rerun the narrowest relevant check."
    );
  }

  if (failed) {
    const investigationRecorded = recordInvestigation(input, flags);
    if (investigationRecorded) {
      messages.push(
        "A redacted investigator handoff was written to .codex/state/investigation-queue.jsonl. Supervisor should assign an INSPECT_ONLY investigator with bounded scope."
      );
    } else {
      messages.push(
        "The redacted investigator handoff could not be written; track this failure manually before continuing."
      );
    }
  }

  if (flags.includes("remote_mutation")) {
    messages.push(
      "A possible remote-mutation tool call completed. Record the approved scope, result, source pointer, and rollback evidence."
    );
  }

  if (flags.includes("governance_surface")) {
    messages.push(
      "A governance surface may have changed. Complete the architecture, work-log, and project-mesh impact check before handoff."
    );
  }

  const recorded = record(input, flags, failed ? "failed" : "completed");
  if (!recorded) {
    messages.push("The local redacted hook ledger is unavailable; do not claim hook evidence.");
  }

  return messages.length > 0 ? additionalContext("PostToolUse", messages) : null;
}

function handlePreCompact(input) {
  const recorded = record(input);
  const continuityWritten = writeContinuity(input);
  const warnings = [];

  if (!recorded || !continuityWritten) {
    warnings.push("Autopilot compact continuity evidence could not be written.");
  }

  return warnings.length > 0
    ? { continue: true, systemMessage: warnings.join(" ") }
    : { continue: true };
}

function handlePostCompact(input) {
  record(input);
  return {
    continue: true,
    systemMessage:
      "Autopilot compaction completed. Re-read AGENTS.md and obtain a fresh relevant mesh packet before further edits."
  };
}

async function handleSubagentStop(input) {
  record(input, [], "subagent_completed");
  await releaseWorkerLock(input);
  recordSubagentStop(input);
  return { continue: true };
}

async function handleStop(input) {
  const recentEvents = readRecentTurnEvents(input);
  const flags = [...new Set(recentEvents.flatMap((entry) => entry.flags || []))].sort();
  const failures = recentEvents.filter((entry) => entry.result === "failed").length;
  const messages = [];

  if (failures > 0) {
    messages.push(`${failures} hook-observed tool result(s) failed in this turn.`);
  }

  if (flags.includes("remote_mutation")) {
    messages.push("Confirm remote-mutation approval, result evidence, and rollback notes.");
  }

  if (flags.includes("governance_surface")) {
    messages.push("Confirm architecture, work-log, and project-mesh impact before claiming completion.");
  }

  if (flags.includes("secret_like_input") || flags.includes("credential_surface")) {
    messages.push("Confirm that no sensitive material was persisted or disclosed.");
  }

  const completionResult = messages.length > 0 ? "completion_review_needed" : "completion_observed";
  record(input, flags, completionResult);

  await writeSessionJsonSafe((state) => {
    const pendingAlerts = [...state.pendingAlerts];

    if (flags.includes("governance_surface") && completionResult !== "completion_observed") {
      pendingAlerts.push(
        createSupervisorAlert(
          "missing_owner_decision",
          "governance_surface_completion_needs_owner_decision"
        )
      );
    }

    return {
      ...state,
      lastUpdatedAt: new Date().toISOString(),
      pendingAlerts,
      hookEventCount: countJsonlLines(LEDGER_PATH),
      investigationQueueDepth: countJsonlLines(INVESTIGATION_QUEUE_PATH)
    };
  });

  return messages.length > 0
    ? {
        continue: true,
        systemMessage: `Autopilot completion check: ${messages.join(" ")}`
      }
    : { continue: true };
}

export async function handleHook(input) {
  switch (input.hook_event_name) {
    case "SessionStart":
      return handleSessionStart(input);
    case "SubagentStart":
      return handleSubagentStart(input);
    case "UserPromptSubmit":
      return handleUserPromptSubmit(input);
    case "PreToolUse":
      return handlePreToolUse(input);
    case "PostToolUse":
      return handlePostToolUse(input);
    case "PreCompact":
      return handlePreCompact(input);
    case "PostCompact":
      return handlePostCompact(input);
    case "SubagentStop":
      return handleSubagentStop(input);
    case "Stop":
      return handleStop(input);
    default:
      record(input, ["unsupported_hook_event"]);
      return null;
  }
}

export const hookTestInternals = {
  createSupervisorAlert
};

function readStdin() {
  return readFileSync(0, "utf8");
}

async function run() {
  let input;

  try {
    input = JSON.parse(readStdin());
  } catch {
    process.stdout.write(
      JSON.stringify({
        continue: true,
        systemMessage: "Autopilot hook received invalid JSON input; hook evidence is unavailable."
      })
    );
    return;
  }

  const response = await handleHook(input);
  if (response) {
    process.stdout.write(JSON.stringify(response));
  }
}

if (resolve(process.argv[1] || "") === SCRIPT_PATH) {
  run().catch(() => {
    process.stdout.write(
      JSON.stringify({
        continue: true,
        systemMessage: "Autopilot hook failed internally; hook evidence is unavailable."
      })
    );
  });
}
