import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ModelOutputQualityState,
  type ModelProviderFamily,
  modelOutputEvaluationPolicy
} from "../src/data/delivery-system/modelOutputEvaluation";
import { isRecord, validateJsonSchema } from "../src/lib/delivery-system/validation";

export interface ModelOutputEvalValidationIssue {
  readonly file: string;
  readonly message: string;
}

export interface ModelOutputEvalValidationReport {
  readonly ok: boolean;
  readonly checkedFiles: readonly string[];
  readonly checkedRecords: number;
  readonly errors: readonly ModelOutputEvalValidationIssue[];
}

export interface ValidateModelOutputEvalRecordInput {
  readonly record: Record<string, unknown>;
  readonly schema: Record<string, unknown>;
  readonly sourceIds: ReadonlySet<string>;
  readonly file?: string;
  readonly repoRoot?: string;
}

export const MODEL_OUTPUT_EVAL_SCHEMA_FILE = "model-output-eval-record.schema.json";
export const MODEL_OUTPUT_EVAL_REQUIRED_FIELDS = [
  "record_version",
  "eval_id",
  "created",
  "project",
  "task",
  "phase",
  "state",
  "model_or_worker",
  "reasoning_profile",
  "token_efficiency_profile",
  "provider_best_practice_sources",
  "input_packet_summary",
  "output_pointer",
  "score_by_dimension",
  "failure_labels",
  "prompt_or_input_delta",
  "rerun_count",
  "accepted_state",
  "verification_evidence",
  "source_pointers",
  "privacy_review"
] as const;

type ModelOutputEvalRequiredField = (typeof MODEL_OUTPUT_EVAL_REQUIRED_FIELDS)[number];

interface SourceCatalog {
  readonly sources: readonly SourceCatalogEntry[];
}

interface SourceCatalogEntry {
  readonly id: string;
}

interface OutputContract {
  readonly schemaFile: string;
  readonly positiveExamples: readonly string[];
  readonly negativeExamples: readonly OutputContractNegativeExample[];
}

interface OutputContractNegativeExample {
  readonly file: string;
  readonly expectedIssue: {
    readonly path: string;
    readonly message: string;
  };
}

const MODEL_OUTPUT_EVAL_ROOT = "model-output-evals";
const RECORDS_DIRECTORY = "records";
const EXAMPLES_DIRECTORY = "examples";
const SOURCE_CATALOG_PATH = join("prompt-library", "source-catalog.json");
const HANDOFF_ID_PATTERN = "^hp-[0-9]{8}-[a-z0-9][a-z0-9-]*$";
const OUTPUT_CONTRACTS: readonly OutputContract[] = [
  {
    schemaFile: "worker-output.schema.json",
    positiveExamples: ["valid-worker-output.json"],
    negativeExamples: [
      {
        file: "invalid-worker-output.json",
        expectedIssue: {
          path: "$.handoff_id",
          message: "is required"
        }
      }
    ]
  },
  {
    schemaFile: "reviewer-output.schema.json",
    positiveExamples: ["valid-reviewer-output.json"],
    negativeExamples: []
  }
];
const NON_EVAL_EXAMPLE_FILES = new Set(
  OUTPUT_CONTRACTS.flatMap((contract) => [
    ...contract.positiveExamples,
    ...contract.negativeExamples.map((example) => example.file)
  ]).map((file) => `${MODEL_OUTPUT_EVAL_ROOT}/${EXAMPLES_DIRECTORY}/${file}`)
);

const FORBIDDEN_KEYS = new Set([
  "raw_output",
  "raw_prompt",
  "raw_context",
  "raw_logs",
  "transcript",
  "command_output",
  "tool_response",
  "secret",
  "credential",
  "api_key",
  "customer_data",
  "private_context",
  "unredacted_context"
]);

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PRIVATE )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i,
  /\bsk-[A-Za-z0-9_\-]{20,}/
];

const POSITIVE_SAMPLE: Record<ModelOutputEvalRequiredField, unknown> = {
  record_version: "v0.1",
  eval_id: "positive-model-output-eval",
  created: "2026-06-11",
  project: {
    slug: "autopilot-control-plane",
    name: "Autopilot Control Plane",
    control_plane: true
  },
  task: {
    task_type: "evaluation",
    summary: "Positive sample for model-output eval validation.",
    risk_level: "medium"
  },
  phase: "learning_immediate_loop",
  state: "accepted",
  model_or_worker: {
    provider: "local",
    name: "deterministic-validator",
    role: "qa"
  },
  reasoning_profile: {
    route: "deterministic_tools",
    reasoning_effort: "none",
    change_policy: "Do not change the route from a fixture."
  },
  token_efficiency_profile: {
    mode: "caveman",
    context_scope: "Only schema, policy, and source catalog.",
    caveman_applied: true
  },
  provider_best_practice_sources: ["local-agents-md", "token-efficiency-operating-model"],
  input_packet_summary: {
    summary: "Positive bounded metadata fixture.",
    allowed_context: ["model-output-evals/model-output-eval-record.schema.json"],
    forbidden_context: ["raw prompts", "raw outputs", "raw logs", "secrets"],
    source_pointers: ["docs/autopilot/model-output-evaluation-operating-model.md"]
  },
  output_pointer: {
    kind: "local_file",
    pointer: "model-output-evals/examples/learning-loop.accepted.example.json",
    summary: "Fixture pointer only."
  },
  score_by_dimension: {
    task_fit: 90,
    instruction_following: 90,
    source_grounding: 90,
    format_contract: 90,
    verification_readiness: 90,
    privacy_safety: 100,
    handoff_clarity: 90,
    token_efficiency: 90,
    workflow_compatibility: 90
  },
  failure_labels: [],
  prompt_or_input_delta: {
    changed: false,
    summary: "No delta for positive sample.",
    changed_fields: [],
    rollback_path: "Remove fixture."
  },
  rerun_count: 0,
  accepted_state: "accepted",
  verification_evidence: [
    {
      type: "local_test",
      status: "passed",
      evidence: "Positive sample validates.",
      source_pointer: "scripts/validate-model-output-evals.ts"
    }
  ],
  source_pointers: [
    "docs/autopilot/model-output-evaluation-operating-model.md",
    "prompt-library/source-catalog.json"
  ],
  privacy_review: {
    redacted_context_only: true,
    raw_output_stored: false,
    raw_prompt_stored: false,
    raw_logs_stored: false,
    secrets_or_customer_data_stored: false,
    reviewer: "validator"
  }
};

export function validateModelOutputEvals(repoRoot = process.cwd()): ModelOutputEvalValidationReport {
  const evalRoot = join(repoRoot, MODEL_OUTPUT_EVAL_ROOT);
  const schemaPath = join(evalRoot, MODEL_OUTPUT_EVAL_SCHEMA_FILE);
  const sourceCatalogPath = join(repoRoot, SOURCE_CATALOG_PATH);
  const checkedFiles: string[] = [];
  const errors: ModelOutputEvalValidationIssue[] = [];

  checkedFiles.push(toRepoPath(repoRoot, schemaPath), toRepoPath(repoRoot, sourceCatalogPath));

  if (!existsSync(evalRoot)) {
    return {
      ok: false,
      checkedFiles,
      checkedRecords: 0,
      errors: [{ file: MODEL_OUTPUT_EVAL_ROOT, message: "Model-output eval root does not exist." }]
    };
  }

  const schema = readJsonFile(schemaPath, repoRoot, errors);
  const sourceCatalogJson = readJsonFile(sourceCatalogPath, repoRoot, errors);
  const sourceIds = new Set(coerceSourceCatalog(sourceCatalogJson)?.sources.map((source) => source.id) ?? []);

  if (isRecord(schema)) {
    validateSchemaShape(schema, schemaPath, repoRoot, errors);
    validatePositiveSample(schema, schemaPath, repoRoot, errors);
    validateMissingRequiredFields(schema, schemaPath, repoRoot, errors);
  }

  validateOutputContracts(evalRoot, repoRoot, checkedFiles, errors);

  const recordFiles = [
    ...listJsonFiles(join(evalRoot, RECORDS_DIRECTORY)),
    ...listJsonFiles(join(evalRoot, EXAMPLES_DIRECTORY)).filter(
      (file) => !NON_EVAL_EXAMPLE_FILES.has(toRepoPath(repoRoot, file))
    )
  ];

  for (const file of recordFiles) {
    checkedFiles.push(toRepoPath(repoRoot, file));
    const record = readJsonFile(file, repoRoot, errors);

    if (!isRecord(record) || !isRecord(schema)) {
      continue;
    }

    errors.push(...validateModelOutputEvalRecord({ record, schema, sourceIds, file, repoRoot }));
  }

  return {
    ok: errors.length === 0,
    checkedFiles: [...new Set(checkedFiles)].sort(),
    checkedRecords: recordFiles.length,
    errors
  };
}

export function validateModelOutputEvalRecord(
  input: ValidateModelOutputEvalRecordInput
): readonly ModelOutputEvalValidationIssue[] {
  const file = input.file ?? "model-output-eval-record.json";
  const repoRoot = input.repoRoot ?? ".";
  const errors: ModelOutputEvalValidationIssue[] = [];

  for (const issue of validateJsonSchema(input.record, input.schema)) {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: `${issue.path}: ${issue.message}`
    });
  }

  validateRecordSemantics(input.record, input.sourceIds, file, repoRoot, errors);
  return errors;
}

export function formatModelOutputEvalValidationReport(report: ModelOutputEvalValidationReport): string {
  const lines = [
    report.ok ? "Model-output eval validation passed." : "Model-output eval validation failed.",
    `Checked files: ${report.checkedFiles.length}`,
    `Checked records: ${report.checkedRecords}`,
    `Errors: ${report.errors.length}`
  ];

  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    lines.push(...report.errors.map((issue) => `- ${issue.file}: ${issue.message}`));
  }

  return lines.join("\n");
}

export function modelOutputEvalValidationExitCode(
  report: Pick<ModelOutputEvalValidationReport, "ok">
): 0 | 1 {
  return report.ok ? 0 : 1;
}

function validateSchemaShape(
  schema: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Schema must declare draft 2020-12." });
  }

  if (schema.$id !== "https://autopilot.local/model-output-evals/model-output-eval-record.schema.json") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Schema $id must match the model-output eval record." });
  }

  if (typeof schema.title !== "string" || schema.title.length === 0) {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Schema must contain a title." });
  }

  if (schema.type !== "object") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Schema root type must be object." });
  }

  if (schema.additionalProperties !== false) {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Schema root must disallow additional properties." });
  }

  const required = getStringArray(schema.required);
  for (const field of MODEL_OUTPUT_EVAL_REQUIRED_FIELDS) {
    if (!required.includes(field)) {
      errors.push({ file: toRepoPath(repoRoot, file), message: `Schema must require ${field}.` });
    }
  }

  const properties = getRecord(schema, "properties");
  const scoreSchema = properties ? getRecord(properties, "score_by_dimension") : undefined;
  const scoreRequired = getStringArray(scoreSchema?.required);
  const scoreProperties = scoreSchema ? getRecord(scoreSchema, "properties") : undefined;

  for (const dimension of modelOutputEvaluationPolicy.dimensions) {
    if (!scoreRequired.includes(dimension)) {
      errors.push({ file: toRepoPath(repoRoot, file), message: `Schema must require score dimension ${dimension}.` });
    }

    if (!scoreProperties || !isRecord(scoreProperties[dimension])) {
      errors.push({ file: toRepoPath(repoRoot, file), message: `Schema must define score dimension ${dimension}.` });
    }
  }
}

function validateOutputContracts(
  evalRoot: string,
  repoRoot: string,
  checkedFiles: string[],
  errors: ModelOutputEvalValidationIssue[]
): void {
  for (const contract of OUTPUT_CONTRACTS) {
    const schemaPath = join(evalRoot, contract.schemaFile);
    checkedFiles.push(toRepoPath(repoRoot, schemaPath));
    const schema = readJsonFile(schemaPath, repoRoot, errors);

    if (!isRecord(schema)) {
      continue;
    }

    validateOutputContractSchemaShape(schema, schemaPath, repoRoot, errors);

    for (const exampleFile of contract.positiveExamples) {
      const examplePath = join(evalRoot, EXAMPLES_DIRECTORY, exampleFile);
      checkedFiles.push(toRepoPath(repoRoot, examplePath));
      const example = readJsonFile(examplePath, repoRoot, errors);

      for (const issue of validateJsonSchema(example, schema)) {
        errors.push({
          file: toRepoPath(repoRoot, examplePath),
          message: `Positive contract example ${issue.path}: ${issue.message}`
        });
      }
      validateNoForbiddenContent(example, "$", examplePath, repoRoot, errors);
    }

    for (const example of contract.negativeExamples) {
      const examplePath = join(evalRoot, EXAMPLES_DIRECTORY, example.file);
      checkedFiles.push(toRepoPath(repoRoot, examplePath));
      const data = readJsonFile(examplePath, repoRoot, errors);
      const issues = validateJsonSchema(data, schema);
      const rejectedAsExpected = issues.some(
        (issue) => issue.path === example.expectedIssue.path && issue.message === example.expectedIssue.message
      );

      if (!rejectedAsExpected) {
        errors.push({
          file: toRepoPath(repoRoot, examplePath),
          message: `Negative contract example did not fail as expected at ${example.expectedIssue.path}.`
        });
      }
      validateNoForbiddenContent(data, "$", examplePath, repoRoot, errors);
    }
  }
}

function validateOutputContractSchemaShape(
  schema: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Output contract schema must declare draft 2020-12." });
  }

  if (typeof schema.$id !== "string" || !schema.$id.startsWith("https://autopilot.local/")) {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Output contract schema must declare an autopilot $id." });
  }

  if (schema.type !== "object") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Output contract schema root type must be object." });
  }

  if (schema.additionalProperties !== false) {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Output contract schema must disallow additional properties." });
  }

  const required = getStringArray(schema.required);
  if (!required.includes("handoff_id")) {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Output contract schema must require handoff_id." });
  }

  const properties = getRecord(schema, "properties");
  const handoffIdSchema = properties ? getRecord(properties, "handoff_id") : undefined;
  if (handoffIdSchema?.pattern !== HANDOFF_ID_PATTERN) {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: `handoff_id must use pattern ${HANDOFF_ID_PATTERN}.`
    });
  }
}

function validatePositiveSample(
  schema: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  for (const issue of validateJsonSchema(POSITIVE_SAMPLE, schema)) {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: `Positive sample ${issue.path}: ${issue.message}`
    });
  }
}

function validateMissingRequiredFields(
  schema: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  for (const field of MODEL_OUTPUT_EVAL_REQUIRED_FIELDS) {
    const negativeSample = cloneSample(POSITIVE_SAMPLE);
    delete negativeSample[field];
    const issues = validateJsonSchema(negativeSample, schema);
    const rejected = issues.some((issue) => issue.path === `$.${field}` && issue.message === "is required");

    if (!rejected) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Schema did not reject missing required field: ${field}.`
      });
    }
  }
}

function validateRecordSemantics(
  record: Record<string, unknown>,
  sourceIds: ReadonlySet<string>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  validateProviderSources(record, sourceIds, file, repoRoot, errors);
  validateAcceptanceState(record, file, repoRoot, errors);
  validatePromptOrInputDelta(record, file, repoRoot, errors);
  validateRepeatedFailureReview(record, file, repoRoot, errors);
  validateWeeklyAggregate(record, file, repoRoot, errors);
  validatePrivacyReview(record, file, repoRoot, errors);
  validateNoForbiddenContent(record, "$", file, repoRoot, errors);
}

function validateProviderSources(
  record: Record<string, unknown>,
  sourceIds: ReadonlySet<string>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  const provider = getProvider(record);
  const providerSources = getStringArray(record.provider_best_practice_sources);
  const policySources: readonly string[] =
    provider in modelOutputEvaluationPolicy.providerBestPracticeSources
      ? modelOutputEvaluationPolicy.providerBestPracticeSources[provider]
      : modelOutputEvaluationPolicy.providerBestPracticeSources.unknown;

  for (const source of providerSources) {
    if (!sourceIds.has(source)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Unknown provider best-practice source id: ${source}.`
      });
    }
  }

  if (!providerSources.some((source) => policySources.includes(source))) {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: `provider_best_practice_sources must include at least one policy source for ${provider}.`
    });
  }
}

function validateAcceptanceState(
  record: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  const state = getQualityState(record);
  const acceptedState = typeof record.accepted_state === "string" ? record.accepted_state : "";
  const score = averageScore(record.score_by_dimension);
  const evidence = Array.isArray(record.verification_evidence) ? record.verification_evidence : [];

  if (state === "accepted") {
    if (acceptedState !== "accepted") {
      errors.push({ file: toRepoPath(repoRoot, file), message: "Accepted records must set accepted_state to accepted." });
    }

    if (score < modelOutputEvaluationPolicy.acceptanceThreshold) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Accepted records must score at least ${modelOutputEvaluationPolicy.acceptanceThreshold} on average.`
      });
    }

    if (evidence.length === 0) {
      errors.push({ file: toRepoPath(repoRoot, file), message: "Accepted records must include verification evidence." });
    }
  }

  if (state !== "accepted" && acceptedState === "accepted") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Only accepted records may set accepted_state to accepted." });
  }

  if (state === "blocked" && acceptedState !== "blocked") {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Blocked records must set accepted_state to blocked." });
  }
}

function validatePromptOrInputDelta(
  record: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  const state = getQualityState(record);
  const delta = getRecord(record, "prompt_or_input_delta");
  const changed = delta?.changed;
  const changedFields = getStringArray(delta?.changed_fields);
  const rerunCount = typeof record.rerun_count === "number" ? record.rerun_count : 0;

  if (state === "retry_with_prompt_or_input_tuning") {
    if (changed !== true || changedFields.length === 0) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: "Retry records must include a meaningful prompt_or_input_delta."
      });
    }
  }

  if (rerunCount > 0 && changed !== true) {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: "Records with reruns must include the prompt or input delta that justified the rerun."
    });
  }
}

function validateRepeatedFailureReview(
  record: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  const state = getQualityState(record);
  const rerunCount = typeof record.rerun_count === "number" ? record.rerun_count : 0;
  const failureLabels = getStringArray(record.failure_labels);
  const repeatedFailure =
    rerunCount >= modelOutputEvaluationPolicy.repeatedFailureLimit || failureLabels.includes("repeated_failure");

  if (!repeatedFailure) {
    return;
  }

  if (state !== "review_model_or_reasoning_route" && state !== "blocked") {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: "Repeated failures must route to model/reasoning review or blocked state."
    });
  }

  if (state === "review_model_or_reasoning_route" && !isRecord(record.route_review)) {
    errors.push({
      file: toRepoPath(repoRoot, file),
      message: "Model/reasoning route review records must include route_review."
    });
  }
}

function validateWeeklyAggregate(
  record: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  if (record.phase !== "weekly_batch_tuning") {
    return;
  }

  if (!isRecord(record.weekly_aggregate)) {
    errors.push({ file: toRepoPath(repoRoot, file), message: "Weekly tuning records must include weekly_aggregate." });
  }
}

function validatePrivacyReview(
  record: Record<string, unknown>,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  const privacy = getRecord(record, "privacy_review");

  if (!privacy) {
    return;
  }

  const expectedBooleans: Readonly<Record<string, boolean>> = {
    redacted_context_only: true,
    raw_output_stored: false,
    raw_prompt_stored: false,
    raw_logs_stored: false,
    secrets_or_customer_data_stored: false
  };

  for (const [field, expected] of Object.entries(expectedBooleans)) {
    if (privacy[field] !== expected) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `privacy_review.${field} must be ${String(expected)}.`
      });
    }
  }
}

function validateNoForbiddenContent(
  value: unknown,
  path: string,
  file: string,
  repoRoot: string,
  errors: ModelOutputEvalValidationIssue[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoForbiddenContent(item, `${path}[${index}]`, file, repoRoot, errors));
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        errors.push({ file: toRepoPath(repoRoot, file), message: `${path}.${key}: forbidden raw or sensitive field.` });
      }
      validateNoForbiddenContent(child, `${path}.${key}`, file, repoRoot, errors);
    }
    return;
  }

  if (typeof value === "string" && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push({ file: toRepoPath(repoRoot, file), message: `${path}: value looks like a secret or credential.` });
  }
}

function getProvider(record: Record<string, unknown>): ModelProviderFamily {
  const modelOrWorker = getRecord(record, "model_or_worker");
  const provider = modelOrWorker?.provider;

  if (
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "google" ||
    provider === "qwen" ||
    provider === "deepseek" ||
    provider === "local" ||
    provider === "unknown"
  ) {
    return provider;
  }

  return "unknown";
}

function getQualityState(record: Record<string, unknown>): ModelOutputQualityState | undefined {
  const state = record.state;

  if (
    state === "needs_scoring" ||
    state === "accepted" ||
    state === "retry_with_prompt_or_input_tuning" ||
    state === "review_model_or_reasoning_route" ||
    state === "blocked"
  ) {
    return state;
  }

  return undefined;
}

function averageScore(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }

  const scores = modelOutputEvaluationPolicy.dimensions.map((dimension) => value[dimension]);
  if (scores.some((score) => typeof score !== "number" || !Number.isFinite(score))) {
    return 0;
  }

  const numericScores = scores as number[];
  return numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length;
}

function readJsonFile(file: string, repoRoot: string, errors: ModelOutputEvalValidationIssue[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse failure.";
    errors.push({ file: toRepoPath(repoRoot, file), message });
    return undefined;
  }
}

function coerceSourceCatalog(value: unknown): SourceCatalog | undefined {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    return undefined;
  }

  return {
    sources: value.sources.filter(isRecord).map((source) => ({ id: String(source.id) }))
  };
}

function listJsonFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return listJsonFiles(path);
    }

    return path.endsWith(".json") ? [path] : [];
  });
}

function getRecord(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function getStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string");
}

function cloneSample(value: Record<ModelOutputEvalRequiredField, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function toRepoPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === currentFile) {
  const report = validateModelOutputEvals();
  console.log(formatModelOutputEvalValidationReport(report));

  const exitCode = modelOutputEvalValidationExitCode(report);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
