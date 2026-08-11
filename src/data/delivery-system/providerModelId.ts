import { AGY_VERIFIED_MODELS } from "./routingModes";

export function isCanonicalModelId(value: string): boolean {
  return value.length > 0 &&
    value.length <= 200 &&
    !value.startsWith("-") &&
    !/[^A-Za-z0-9._:/-]/.test(value);
}

export const QUOTA_LABEL_TO_CANONICAL: Readonly<Record<
  "claude_cli" | "agy_cli",
  Readonly<Record<string, readonly string[]>>
>> = {
  claude_cli: {
    // Labels verified from real `claude --ax-screen-reader` /usage captures
    // (tests/fixtures/provider-usage/claude-usage-2.1.216-api-billing.txt,
    // claude-usage-2.1.216-subscription.txt, and claude-usage-2.1.226-subscription.txt):
    // the header model line, per-family weekly sections, and the
    // "Extended: <Model> is included in your weekly limit" banner.
    "Opus 4.8": ["claude-opus-4-8"],
    "Fable 5": ["claude-fable-5"],
    // Remaining current published models the installed CLI routes to (`--model` accepts the
    // full ids; labels follow the CLI's "<Family> <version>" display convention).
    "Opus 5": ["claude-opus-5"],
    "Sonnet 5": ["claude-sonnet-5"],
    "Haiku 4.5": ["claude-haiku-4-5-20251001"],
    // Per-family weekly sections ("Current week (Fable)") use the bare family label.
    "Fable": ["claude-fable-5"],
    "Opus": ["claude-opus-5", "claude-opus-4-8"],
    "Sonnet": ["claude-sonnet-5"],
    "Haiku": ["claude-haiku-4-5-20251001"]
  },
  agy_cli: {
    "Gemini Flash": [AGY_VERIFIED_MODELS.agy_fast_default, AGY_VERIFIED_MODELS.agy_fast_quality],
    "Gemini Pro": [AGY_VERIFIED_MODELS.agy_deep],
    "Claude Sonnet": [AGY_VERIFIED_MODELS.agy_claude_sonnet_4_6],
    "GPT-OSS": [AGY_VERIFIED_MODELS.agy_gpt_oss_120b]
  }
};

export function expandQuotaLabel(provider: "claude_cli" | "agy_cli", label: string): readonly string[] {
  const mappings = QUOTA_LABEL_TO_CANONICAL[provider];
  return Object.hasOwn(mappings, label) ? mappings[label] ?? [] : [];
}
