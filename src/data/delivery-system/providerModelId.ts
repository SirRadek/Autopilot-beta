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
    "Opus 4.8": ["claude-opus-4-8"]
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
