import { describe, expect, it } from "vitest";

import {
  buildAgentPacket,
  buildProjectMeshPacket,
  explainNode,
  findRequiredAgents,
  findRisks,
  getRelevantSubgraph,
  loadProjectDecisionMeshFromRoot,
  loadDecisionMeshFromRoot,
  selectCapabilities
} from "../../src/lib/decision-mesh";

const mesh = loadDecisionMeshFromRoot(process.cwd());
const NO_MATCH_TASK = "Polish the archival naming convention";

describe("Decision Mesh queries", () => {
  it("loads the seed mesh with required reasoning fields", () => {
    expect(mesh.nodes.length).toBeGreaterThanOrEqual(8);
    expect(mesh.edges.length).toBeGreaterThanOrEqual(8);

    const fileUpload = mesh.nodes.find((node) => node.id === "file_upload");

    expect(fileUpload?.why).toContain("Upload");
    expect(fileUpload?.signals).toContain("avatar");
    expect(fileUpload?.required_checks).toContain("reject_unauthenticated");
  });

  it("finds upload, auth, storage, security, frontend, and QA context for avatar uploads", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Add authenticated avatar upload",
      agent: "backend",
      max_nodes: 7
    });

    expect(result.relevant_nodes.map((node) => node.id)).toEqual([
      "file_upload",
      "frontend_form",
      "qa_upload_tests",
      "security_upload",
      "auth_required",
      "user_profile",
      "storage_provider"
    ]);
    expect(result.required_agents).toEqual(["backend", "frontend", "security", "qa"]);
    expect(result.excluded).toContain("payments_checkout");
  });

  it("builds a compact backend packet without returning the full graph", () => {
    const packet = buildAgentPacket(mesh, {
      task: "Add authenticated avatar upload",
      agent: "backend",
      token_budget: 8000
    });

    expect(packet.agent).toBe("backend");
    expect(packet.task).toBe("Add authenticated avatar upload");
    expect(packet.relevant_nodes).toContain("file_upload");
    expect(packet.required_agents).toEqual(["backend", "frontend", "security", "qa"]);
    expect(packet.must_read).toContain("src/auth/session.ts");
    expect(packet.must_read).toContain("src/storage/index.ts");
    expect(packet.required_checks).toContain("reject_unauthenticated");
    expect(packet.required_checks).toContain("validate_file_size");
    expect(packet.must_not_assume).toContain("Do not assume S3.");
    expect(packet.relevant_nodes.length).toBeLessThan(mesh.nodes.length);
  });

  it("never drops a task-relevant blocker to token-budget truncation (AF4)", () => {
    const task = "Add authenticated avatar upload";
    const blockerIds = new Set(
      mesh.rules.filter((rule) => rule.severity === "blocker").map((rule) => rule.id)
    );
    const full = buildAgentPacket(mesh, { task, agent: "backend", token_budget: 8000 });
    const tiny = buildAgentPacket(mesh, { task, agent: "backend", token_budget: 1000 }); // maxNodes = 4
    const fullBlockers = full.rules.filter((id) => blockerIds.has(id));
    expect(fullBlockers.length).toBeGreaterThan(0); // meaningful: there are blockers to protect
    // the tiny budget keeps only the top-4 nodes by score, but no relevant blocker may be lost
    for (const blocker of fullBlockers) {
      expect(tiny.rules).toContain(blocker);
    }
  });

  it("never drops an EDGE-reachable blocker to truncation (AF4 frontier, budget-independent)", () => {
    // A blocker whose carrier scores 0 on the task but is one edge from a directly-scored node
    // (the escalates_when_combined frontier) used to be truncated at a tight budget. The blocker
    // set must now be budget-independent: every blocker at a generous budget survives at a tiny one.
    const task = "work on reasoning strategy";
    const blockerIds = new Set(
      mesh.rules.filter((rule) => rule.severity === "blocker").map((rule) => rule.id)
    );
    const generous = buildAgentPacket(mesh, { task, agent: "architect", token_budget: 12000 });
    const tiny = buildAgentPacket(mesh, { task, agent: "architect", token_budget: 1000 }); // maxNodes = 4
    const generousBlockers = generous.rules.filter((id) => blockerIds.has(id));
    expect(generousBlockers.length).toBeGreaterThan(0); // non-vacuous: this task pulls in blockers
    for (const blocker of generousBlockers) {
      expect(tiny.rules).toContain(blocker);
    }
  });

  it("explains a node with its connected risks and outbound requirements", () => {
    const explanation = explainNode(mesh, "file_upload");

    expect(explanation.id).toBe("file_upload");
    expect(explanation.why).toContain("untrusted user content");
    expect(explanation.required_agents).toEqual(["backend", "frontend", "security", "qa"]);
    expect(explanation.connections.map((edge) => edge.to)).toContain("security_upload");
    expect(explanation.connected_risks).toContain("security_upload");
  });

  it("finds required agents and reasons for checkout work", () => {
    const result = findRequiredAgents(mesh, {
      task: "Change subscription checkout"
    });

    expect(result.required_agents).toEqual(["architect", "backend", "frontend", "security", "business", "qa"]);
    expect(result.reason).toContain("Checkout affects revenue and payment flow.");
  });

  it("finds task-specific risks and stop conditions", () => {
    const result = findRisks(mesh, {
      task: "Add public file upload endpoint"
    });

    expect(result.risks.map((risk) => risk.id)).toContain("file_upload");
    expect(result.risks.map((risk) => risk.id)).toContain("public_api");
    expect(result.stop_conditions).toContain("missing_auth_check");
    expect(result.stop_conditions).toContain("public_endpoint_without_rate_limit");
  });

  it("routes strategic reasoning work to the reasoning strategy node", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Use frontier reasoning for deep research, architecture review, security audit, and local worker routing",
      agent: "architect",
      max_nodes: 4
    });

    expect(result.relevant_nodes[0]?.id).toBe("reasoning_strategy");
    expect(result.required_agents).toContain("architect");
    expect(result.required_agents).toContain("security");
    expect(findRisks(mesh, { task: "Use non local worker for boilerplate coding" }).stop_conditions).toContain(
      "non_local_worker_dependency"
    );
  });

  it("routes prompt library work through prompt policy and blocks unverified prompt adoption", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Add a GPT Claude Gemini Qwen prompt library with prompt evals, source authority, and version rollback",
      agent: "architect",
      max_nodes: 5
    });

    expect(result.relevant_nodes.map((node) => node.id)).toContain("prompt_library_policy");
    expect(result.required_agents).toEqual(expect.arrayContaining(["architect", "qa"]));
    const promptNode = result.relevant_nodes.find((node) => node.id === "prompt_library_policy");
    expect(promptNode?.required_checks).toEqual(
      expect.arrayContaining(["prompt_metadata_complete", "prompt_eval_defined", "official_provider_docs_verified"])
    );
    expect(findRisks(mesh, { task: "Adopt leaked system prompts without evals" }).stop_conditions).toEqual(
      expect.arrayContaining(["leaked_system_prompt_used", "prompt_without_eval"])
    );
  });

  it("routes model-output evaluation and prompt tuning through eval policy", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Score a bad model output, tune the prompt input, rerun until acceptable, and change reasoning after repeated failures",
      agent: "architect",
      max_nodes: 6
    });

    expect(result.relevant_nodes.map((node) => node.id)).toContain("model_output_evaluation_policy");
    const evalNode = result.relevant_nodes.find((node) => node.id === "model_output_evaluation_policy");
    expect(evalNode?.required_checks).toEqual(
      expect.arrayContaining([
        "model_output_scored_before_acceptance",
        "prompt_or_input_delta_recorded_before_rerun",
        "repeated_failure_triggers_model_or_reasoning_review"
      ])
    );
    expect(findRisks(mesh, { task: "Retry bad output without prompt input delta" }).stop_conditions).toEqual(
      expect.arrayContaining(["bad_output_retried_without_prompt_or_input_delta"])
    );
  });

  it("routes protective supervision work through currentness, handoff, progress, and blocker guardrails", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Add a protective currentness sentinel that compiles agent output into next-agent handoff packets and tracks progress blockers",
      agent: "architect",
      max_nodes: 5
    });

    expect(result.relevant_nodes.map((node) => node.id)).toContain("protective_supervision_policy");
    expect(result.required_agents).toEqual(expect.arrayContaining(["architect", "qa"]));
    const protectiveNode = result.relevant_nodes.find((node) => node.id === "protective_supervision_policy");
    expect(protectiveNode?.required_checks).toEqual(
      expect.arrayContaining(["agent_output_normalized", "progress_state_updated", "blocker_owner_declared"])
    );
    expect(
      findRisks(mesh, { task: "Pass raw agent output as next prompt without blocker owner" }).stop_conditions
    ).toEqual(expect.arrayContaining(["raw_agent_output_used_as_next_prompt", "blocker_without_owner"]));
  });

  it("returns an empty subgraph when no task signal matches", () => {
    const result = getRelevantSubgraph(mesh, {
      task: NO_MATCH_TASK,
      agent: "architect",
      max_nodes: 4
    });

    expect(result.relevant_nodes).toEqual([]);
    expect(result.relevant_edges).toEqual([]);
    expect(result.required_agents).toEqual([]);
    expect(result.excluded.length).toBe(mesh.nodes.length);
  });

  it("returns no risks or stop conditions when no task signal matches", () => {
    const result = findRisks(mesh, {
      task: NO_MATCH_TASK
    });

    expect(result.risks).toEqual([]);
    expect(result.stop_conditions).toEqual([]);
    expect(result.stop_conditions).not.toEqual(
      expect.arrayContaining([
        "core_web_vitals_regression",
        "unapproved_indexing_change",
        "seo_content_hidden_in_canvas"
      ])
    );
  });

  it("flags no_governance_matched and forces the governance floor when no task signal matches", () => {
    const packet = buildAgentPacket(mesh, {
      task: NO_MATCH_TASK,
      agent: "architect",
      token_budget: 4000
    });

    // The miss is no longer silent: the packet carries the always-applicable floor + the flag,
    // so the agent must stop and reclassify instead of proceeding on an advice-free packet.
    expect(packet.no_governance_matched).toBe(true);
    expect(packet.relevant_nodes).toEqual(["capability_routing", "context_economy_policy"]);
    expect(packet.rules.length).toBeGreaterThan(0);
  });

  it("does not flag no_governance_matched when the task matches (governance is present)", () => {
    const packet = buildAgentPacket(mesh, {
      task: "Add authenticated avatar upload",
      agent: "backend",
      token_budget: 8000
    });

    expect(packet.no_governance_matched).toBeUndefined();
    expect(packet.relevant_nodes).toContain("file_upload");
  });

  it("flags no_governance_matched on a project packet miss (no root floor in a project mesh)", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "autopilot-control-plane");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "autopilot-control-plane",
      task: NO_MATCH_TASK,
      agent: "architect",
      max_nodes: 4
    });

    // A project mesh has no root-mesh floor nodes, so the node set stays empty — but the flag is
    // the load-bearing signal, and it must still fire.
    expect(packet.no_governance_matched).toBe(true);
    expect(packet.relevant_nodes).toEqual([]);
    expect(packet.rules).toEqual([]);
    expect(packet.stop_conditions).toEqual([]);
  });

  it("keeps scored exact node matches ahead of neighboring expansion at low max_nodes", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Update prompt library, compact context, token policy, and model spend",
      agent: "architect",
      max_nodes: 3
    });

    expect(result.relevant_nodes.map((node) => node.id)).toEqual([
      "prompt_library_policy",
      "context_economy_policy",
      "model_spend_policy"
    ]);
  });

  it("routes per-project mesh lifecycle work to the project mesh node", () => {
    const result = getRelevantSubgraph(mesh, {
      task: "Create a separate decision mesh for a new project during architecture onboarding and update it after completion",
      agent: "architect",
      max_nodes: 4
    });

    expect(result.relevant_nodes[0]?.id).toBe("project_mesh_lifecycle");
    expect(findRisks(mesh, { task: "Project has no mesh during architecture start" }).stop_conditions).toContain(
      "missing_project_mesh"
    );
  });

  it("selects service capabilities through the existing Decision Mesh layer", () => {
    const result = selectCapabilities(mesh, {
      task: "Optimize a slow website with SEO issues, broken links, and poor Core Web Vitals"
    });

    expect(result.capabilities).toEqual(expect.arrayContaining(["optimization_mesh", "seo_mesh"]));
    expect(result.avoided_capabilities).toContain("three_d_experience_addon");
    expect(result.required_agents).toEqual(expect.arrayContaining(["seo_performance", "frontend"]));
    expect(result.relevant_nodes).toEqual(expect.arrayContaining(["optimization_mesh", "seo_mesh"]));
  });

  it("does not fall back unknown capability requests to optimization or SEO", () => {
    const result = selectCapabilities(mesh, {
      task: "Polish the archival naming convention"
    });

    expect(result.capabilities).toEqual([]);
    expect(result.optional_capabilities).toEqual([]);
    expect(result.avoided_capabilities).toEqual([]);
    expect(result.relevant_nodes).toEqual([]);
    expect(result.required_checks).toEqual([]);
    expect(result.stop_conditions).toEqual([]);
  });

  it("routes diagnostics through observability with project/control-plane separation checks", () => {
    const result = selectCapabilities(mesh, {
      task: "Inspect logs, tracing, runtime errors, and bottlenecks while separating Autopilot from project issues"
    });

    expect(result.capabilities).toContain("observability_mesh");
    expect(result.required_checks).toEqual(
      expect.arrayContaining([
        "problem_scope_classified",
        "autopilot_vs_project_boundary",
        "redacted_log_summary",
        "baseline_metric",
        "suspect_layer_identified"
      ])
    );
    expect(findRisks(mesh, { task: "Copy raw project logs into Autopilot" }).stop_conditions).toContain(
      "raw_project_logs_copied_to_autopilot"
    );
  });

  it("routes failed advisory model runs as control-plane diagnostics before content review", () => {
    const task =
      "Diagnose Autopilot advisory model run: Claude CLI syntax error, Gemini trust flag failed, DeepSeek unavailable, runner log contains prompt only, no model output, waiting owner";
    const result = selectCapabilities(mesh, { task });

    expect(result.capabilities).toContain("observability_mesh");
    expect(result.required_checks).toEqual(
      expect.arrayContaining([
        "problem_scope_classified",
        "provider_run_status_recorded",
        "runner_artifact_contract_verified",
        "model_output_presence_verified"
      ])
    );

    const subgraph = getRelevantSubgraph(mesh, {
      task,
      agent: "protective-supervisor",
      max_nodes: 8
    });

    expect(subgraph.relevant_nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "observability_mesh",
        "model_output_evaluation_policy",
        "reasoning_strategy",
        "protective_supervision_policy"
      ])
    );
    expect(findRisks(mesh, { task }).stop_conditions).toEqual(
      expect.arrayContaining([
        "provider_run_failed_without_blocked_state",
        "model_output_missing_from_artifact",
        "advisory_workflow_continued_after_provider_error"
      ])
    );
  });

  it("builds a compact project-specific mesh packet", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "radeq");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "radeq",
      task: "Change lead capture form validation and D1 storage behavior",
      agent: "backend_database",
      max_nodes: 4
    });

    expect(packet.project_slug).toBe("radeq");
    expect(packet.relevant_nodes).toContain("lead_capture_pipeline");
    expect(packet.rules.map((rule) => rule.id)).toContain("RAD-LEADS-001");
    expect(packet.rules.find((rule) => rule.id === "RAD-LEADS-001")).toMatchObject({
      severity: "blocker",
      instruction: expect.stringContaining("Client and server validation")
    });
    expect(packet.required_checks).toContain("server_validation");
    expect(packet.stop_conditions).toContain("missing_server_validation");
  });

  it("keeps Radeq runtime diagnostics inside the Radeq project mesh", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "radeq");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "radeq",
      task: "Diagnose Radeq Cloudflare deploy logs, client console errors, D1 lead API failures, and Core Web Vitals bottlenecks",
      agent: "qa",
      max_nodes: 4
    });

    expect(packet.relevant_nodes).toContain("runtime_observability_boundary");
    expect(packet.required_checks).toEqual(
      expect.arrayContaining(["project_slug_confirmed", "redacted_log_summary", "suspect_layer_identified"])
    );
    expect(packet.stop_conditions).toContain("raw_project_logs_copied_to_autopilot");
  });

  it("keeps Autopilot prompt library work inside the control-plane project mesh", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "autopilot-control-plane");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "autopilot-control-plane",
      task: "Plan prompt library adoption for GPT Claude Gemini Qwen with evals and source authority",
      agent: "architect",
      max_nodes: 4
    });

    expect(packet.relevant_nodes).toContain("prompt_library_boundary");
    expect(packet.rules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["ACP-PROMPT-001"]));
    expect(packet.must_not_assume).toEqual(
      expect.arrayContaining(["Do not treat public prompt packs as source of truth."])
    );
    expect(packet.required_checks).toEqual(
      expect.arrayContaining(["prompt_metadata_complete", "prompt_eval_defined", "official_provider_docs_verified"])
    );
    expect(packet.stop_conditions).toContain("paid_prompt_management_tool_required");
  });

  it("keeps Autopilot model-output tuning inside the control-plane project mesh", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "autopilot-control-plane");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "autopilot-control-plane",
      task: "Evaluate bad Claude and Gemini model output, tune prompts, rerun, and after repeated failures change reasoning route",
      agent: "architect",
      max_nodes: 5
    });

    expect(packet.relevant_nodes).toContain("model_output_evaluation_boundary");
    expect(packet.rules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["ACP-MODEL-EVAL-001"]));
    expect(packet.required_checks).toEqual(
      expect.arrayContaining([
        "model_output_scored_before_acceptance",
        "caveman_or_token_efficiency_route_selected",
        "provider_best_practice_sources_checked"
      ])
    );
    expect(packet.stop_conditions).toContain("repeated_bad_output_without_model_or_reasoning_review");
  });

  it("keeps failed advisory runner artifacts inside the control-plane project mesh", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "autopilot-control-plane");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "autopilot-control-plane",
      task: "Diagnose failed Claude Gemini DeepSeek advisory runner artifact: CLI syntax error, provider unavailable, prompt-only log, no model output, blocked waiting owner",
      agent: "protective-supervisor",
      max_nodes: 7
    });

    expect(packet.relevant_nodes).toEqual(
      expect.arrayContaining([
        "control_plane_observability_boundary",
        "model_output_evaluation_boundary",
        "model_reasoning_boundary",
        "protective_supervision_boundary"
      ])
    );
    expect(packet.rules.map((rule) => rule.id)).toContain("ACP-MODEL-RUN-001");
    expect(packet.required_checks).toEqual(
      expect.arrayContaining([
        "provider_run_status_recorded",
        "runner_artifact_contract_verified",
        "model_output_presence_verified",
        "blocked_state_recorded_when_output_missing"
      ])
    );
    expect(packet.stop_conditions).toEqual(
      expect.arrayContaining([
        "provider_run_failed_without_blocked_state",
        "model_output_missing_from_artifact",
        "advisory_workflow_continued_after_provider_error"
      ])
    );
  });

  it("keeps Autopilot protective supervision inside the control-plane project mesh", () => {
    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "autopilot-control-plane");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "autopilot-control-plane",
      task: "Run protective supervision for currentness, agent handoff packets, progress ledger state, blockers, and waiting dependencies",
      agent: "architect",
      max_nodes: 5
    });

    expect(packet.relevant_nodes).toContain("protective_supervision_boundary");
    expect(packet.required_checks).toEqual(
      expect.arrayContaining(["official_docs_or_context7_for_currentness", "agent_output_normalized"])
    );
    expect(packet.stop_conditions).toContain("duplicate_runtime_queue");
  });

  it("routes Codex lifecycle hooks through report-first control-plane boundaries", () => {
    const rootMesh = loadDecisionMeshFromRoot(process.cwd());
    const subgraph = getRelevantSubgraph(rootMesh, {
      task: "Add Codex hooks for session start, tool risk checks, compaction continuity, and stop evidence",
      agent: "architect",
      max_nodes: 6
    });

    const hookNode = subgraph.relevant_nodes.find((node) => node.id === "codex_hooks_guardrail");

    expect(hookNode).toBeDefined();
    expect(hookNode?.stop_conditions).toContain("hook_stores_raw_sensitive_content");

    const projectMesh = loadProjectDecisionMeshFromRoot(process.cwd(), "autopilot-control-plane");
    const packet = buildProjectMeshPacket(projectMesh, {
      project_slug: "autopilot-control-plane",
      task: "Implement project-local Codex hooks as redacted report-first lifecycle guardrails",
      agent: "architect",
      max_nodes: 5
    });

    expect(packet.relevant_nodes).toContain("codex_hooks_boundary");
    expect(packet.required_checks).toEqual(
      expect.arrayContaining(["exact_hook_definition_trusted", "runtime_activation_evidence_separate"])
    );
    expect(packet.stop_conditions).toContain("runtime_activation_claim_without_evidence");
  });

  it("loads supervisor execution mesh nodes with explicit failure modes", () => {
    const nodeIds = [
      "subscription_worker_boundary",
      "skill_registry_policy",
      "reuse_gate",
      "supervisor_execution_loop"
    ];

    for (const nodeId of nodeIds) {
      const node = mesh.nodes.find((candidate) => candidate.id === nodeId);

      expect(node?.failure_modes?.length).toBeGreaterThanOrEqual(3);
    }
  });
});
