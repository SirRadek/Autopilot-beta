export type GraphicOutputKind =
  | "brand_system"
  | "static_vector"
  | "motion_background"
  | "physics_motion"
  | "webgl_scene"
  | "model_asset"
  | "video_storyboard";

export type GraphicToolId =
  | "html_css_svg"
  | "canvas_2d"
  | "three_js"
  | "rapier_physics"
  | "blender"
  | "playwright_capture"
  | "figma"
  | "canva"
  | "hyperframes"
  | "kling_ai";

export type GraphicToolTier = "local_free_default" | "optional_cloud_free" | "optional_paid_cloud";

export interface GraphicToolPolicy {
  readonly id: GraphicToolId;
  readonly tier: GraphicToolTier;
  readonly useFor: readonly GraphicOutputKind[];
  readonly requiresOwnerDecision: boolean;
  readonly requiresCostCheck: boolean;
  readonly notes: readonly string[];
}

export interface GraphicRouteRule {
  readonly id: string;
  readonly signals: readonly string[];
  readonly outputs: readonly GraphicOutputKind[];
  readonly preferredTools: readonly GraphicToolId[];
  readonly fallbackTools: readonly GraphicToolId[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface GraphicAgentPolicy {
  readonly agentId: "graphic-production-agent";
  readonly defaultPrinciple: "dom_content_first_motion_second";
  readonly sourceOfTruth: "typed_policy_and_project_brief";
  readonly defaultTools: readonly GraphicToolId[];
  readonly freeCloudToolsAllowed: readonly GraphicToolId[];
  readonly paidToolsRequireOwnerDecision: readonly GraphicToolId[];
  readonly requiredInputs: readonly string[];
  readonly requiredOutputs: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface GraphicRouteSelectionInput {
  readonly task: string;
}

export interface GraphicRouteSelectionResult {
  readonly activateAgent: "graphic-production-agent";
  readonly matchedRules: readonly string[];
  readonly outputs: readonly GraphicOutputKind[];
  readonly preferredTools: readonly GraphicToolId[];
  readonly fallbackTools: readonly GraphicToolId[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export const graphicToolPolicies = [
  {
    id: "html_css_svg",
    tier: "local_free_default",
    useFor: ["brand_system", "static_vector", "motion_background"],
    requiresOwnerDecision: false,
    requiresCostCheck: false,
    notes: ["Use for logos, icons, layout frames, masks, simple motion, and SEO-safe graphics."]
  },
  {
    id: "canvas_2d",
    tier: "local_free_default",
    useFor: ["motion_background", "physics_motion"],
    requiresOwnerDecision: false,
    requiresCostCheck: false,
    notes: ["Use for lightweight particles, mesh fields, vector motion, and cheap procedural backgrounds."]
  },
  {
    id: "three_js",
    tier: "local_free_default",
    useFor: ["webgl_scene", "model_asset", "motion_background"],
    requiresOwnerDecision: false,
    requiresCostCheck: false,
    notes: ["Use only when depth, camera, model movement, or WebGL materially explains the product or system state."]
  },
  {
    id: "rapier_physics",
    tier: "local_free_default",
    useFor: ["physics_motion", "webgl_scene"],
    requiresOwnerDecision: false,
    requiresCostCheck: false,
    notes: ["Use only for real collisions, gravity, constraints, or rigid-body behavior; not for simple easing."]
  },
  {
    id: "blender",
    tier: "local_free_default",
    useFor: ["model_asset", "video_storyboard"],
    requiresOwnerDecision: false,
    requiresCostCheck: false,
    notes: ["Use for local GLB assets, simple model cleanup, cameras, and offline renders when installed."]
  },
  {
    id: "playwright_capture",
    tier: "local_free_default",
    useFor: ["video_storyboard", "brand_system"],
    requiresOwnerDecision: false,
    requiresCostCheck: false,
    notes: ["Use for screenshots, visual verification, and frame capture evidence."]
  },
  {
    id: "figma",
    tier: "optional_cloud_free",
    useFor: ["brand_system", "static_vector"],
    requiresOwnerDecision: false,
    requiresCostCheck: true,
    notes: ["Use when a collaborative editable design file is needed and the free/no-cost path is confirmed."]
  },
  {
    id: "canva",
    tier: "optional_cloud_free",
    useFor: ["brand_system", "static_vector", "video_storyboard"],
    requiresOwnerDecision: false,
    requiresCostCheck: true,
    notes: ["Use for templated marketing assets when the free/no-cost path is confirmed."]
  },
  {
    id: "hyperframes",
    tier: "optional_cloud_free",
    useFor: ["video_storyboard"],
    requiresOwnerDecision: false,
    requiresCostCheck: true,
    notes: ["Use as a deterministic HTML-to-video lane when video output is requested and no paid plan is required."]
  },
  {
    id: "kling_ai",
    tier: "optional_paid_cloud",
    useFor: ["video_storyboard"],
    requiresOwnerDecision: true,
    requiresCostCheck: true,
    notes: ["Blocked by default because it is cloud-based and may consume paid credits; use only after a later owner exception."]
  }
] as const satisfies readonly GraphicToolPolicy[];

export const graphicAgentPolicy = {
  agentId: "graphic-production-agent",
  defaultPrinciple: "dom_content_first_motion_second",
  sourceOfTruth: "typed_policy_and_project_brief",
  defaultTools: ["html_css_svg", "canvas_2d", "three_js", "rapier_physics", "blender", "playwright_capture"],
  freeCloudToolsAllowed: ["figma", "canva", "hyperframes"],
  paidToolsRequireOwnerDecision: ["kling_ai"],
  requiredInputs: [
    "visual_goal",
    "target_surface",
    "audience",
    "brand_constraints",
    "content_that_must_remain_dom_accessible",
    "motion_intensity",
    "asset_budget",
    "performance_budget"
  ],
  requiredOutputs: [
    "visual_brief",
    "tool_route",
    "asset_manifest",
    "implementation_notes",
    "fallback_plan",
    "verification_evidence"
  ],
  requiredChecks: [
    "seo_content_outside_canvas",
    "reduced_motion_support",
    "mobile_fallback",
    "performance_budget",
    "contrast_check",
    "responsive_check",
    "visual_regression_capture",
    "free_tier_or_no_cost_confirmed",
    "owner_cost_decision_for_paid_tools"
  ],
  stopConditions: [
    "primary_content_hidden_in_canvas",
    "missing_reduced_motion_fallback",
    "missing_mobile_fallback",
    "performance_budget_missing",
    "cloud_tool_without_free_tier_confirmation",
    "paid_tool_without_owner_exception",
    "unlicensed_or_unknown_asset_source",
    "visual_direction_missing"
  ]
} as const satisfies GraphicAgentPolicy;

export const graphicRouteRules = [
  {
    id: "brand_or_static_graphics",
    signals: ["brand", "logo", "icon", "illustration", "static", "vector", "graphic system"],
    outputs: ["brand_system", "static_vector"],
    preferredTools: ["html_css_svg"],
    fallbackTools: ["figma", "canva"],
    requiredChecks: ["contrast_check", "responsive_check", "asset_manifest"],
    stopConditions: ["visual_direction_missing", "unlicensed_or_unknown_asset_source"]
  },
  {
    id: "motion_background",
    signals: ["motion", "background", "moving", "particles", "animated", "web background"],
    outputs: ["motion_background"],
    preferredTools: ["html_css_svg", "canvas_2d"],
    fallbackTools: ["three_js"],
    requiredChecks: ["reduced_motion_support", "mobile_fallback", "performance_budget"],
    stopConditions: ["missing_reduced_motion_fallback", "missing_mobile_fallback", "performance_budget_missing"]
  },
  {
    id: "simple_physics_visual",
    signals: ["physics", "gravity", "collision", "spring", "rigid", "simulate"],
    outputs: ["physics_motion"],
    preferredTools: ["canvas_2d", "rapier_physics"],
    fallbackTools: ["html_css_svg"],
    requiredChecks: ["performance_budget", "reduced_motion_support", "deterministic_seed"],
    stopConditions: ["performance_budget_missing", "missing_reduced_motion_fallback"]
  },
  {
    id: "moving_model_or_depth",
    signals: ["3d", "webgl", "model", "glb", "depth", "camera", "orbit"],
    outputs: ["webgl_scene", "model_asset"],
    preferredTools: ["three_js", "blender"],
    fallbackTools: ["canvas_2d"],
    requiredChecks: ["seo_content_outside_canvas", "mobile_fallback", "performance_budget", "visual_regression_capture"],
    stopConditions: ["primary_content_hidden_in_canvas", "missing_mobile_fallback", "performance_budget_missing"]
  },
  {
    id: "video_or_cinematic_storyboard",
    signals: ["video", "cinematic", "kling", "hyperframes", "storyboard", "promo", "reel"],
    outputs: ["video_storyboard"],
    preferredTools: ["hyperframes", "playwright_capture"],
    fallbackTools: ["html_css_svg", "canvas_2d"],
    requiredChecks: ["free_tier_or_no_cost_confirmed", "owner_cost_decision_for_paid_tools", "asset_manifest", "usage_rights_check"],
    stopConditions: [
      "cloud_tool_without_free_tier_confirmation",
      "paid_tool_without_owner_exception",
      "unlicensed_or_unknown_asset_source"
    ]
  }
] as const satisfies readonly GraphicRouteRule[];

export function selectGraphicRoute(input: GraphicRouteSelectionInput): GraphicRouteSelectionResult {
  const normalizedTask = normalize(input.task);
  const matchedRules = graphicRouteRules.filter((rule) =>
    rule.signals.some((signal) => containsTerm(normalizedTask, signal))
  );
  const rules = matchedRules.length > 0 ? matchedRules : [graphicRouteRules[0]];

  return {
    activateAgent: "graphic-production-agent",
    matchedRules: rules.map((rule) => rule.id),
    outputs: unique(rules.flatMap((rule) => rule.outputs)),
    preferredTools: unique(rules.flatMap((rule) => rule.preferredTools)),
    fallbackTools: unique(rules.flatMap((rule) => rule.fallbackTools)),
    requiredChecks: unique([...graphicAgentPolicy.requiredChecks, ...rules.flatMap((rule) => rule.requiredChecks)]),
    stopConditions: unique([...graphicAgentPolicy.stopConditions, ...rules.flatMap((rule) => rule.stopConditions)])
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function containsTerm(normalizedTask: string, term: string): boolean {
  const normalizedTerm = normalize(term);

  if (normalizedTerm.includes(" ")) {
    return normalizedTask.includes(normalizedTerm);
  }

  return normalizedTask.split(/\s+/).includes(normalizedTerm);
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
