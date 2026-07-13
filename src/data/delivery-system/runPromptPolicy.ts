export const RUN_PROMPT_TOKEN_HARD_CAP = 9_000;
export const RUN_PROMPT_REVIEW_THRESHOLD = 1_000;
export const RUN_OUTPUT_TOKEN_ALLOWANCE_MAX = 16_000;
export const RUN_OUTPUT_TOKEN_ALLOWANCE = 8_192;

// Every model token consumes at least one byte of its UTF-8 representation, including byte-fallback
// tokenizers. Using UTF-8 bytes is therefore a deliberately conservative tokenizer-independent cap.
export function conservativeRunPromptTokens(prompt: string): number {
  return Buffer.byteLength(prompt, "utf8");
}

export function assertRunPromptPolicy(prompt: string, reviewAcknowledged: boolean): number {
  const tokens = conservativeRunPromptTokens(prompt);
  if (tokens >= RUN_PROMPT_TOKEN_HARD_CAP) throw new Error("run_prompt_token_cap_exceeded");
  if (tokens > RUN_PROMPT_REVIEW_THRESHOLD && !reviewAcknowledged) throw new Error("run_prompt_review_required");
  return tokens;
}

export function canonicalRunTokenBudget(prompt: string): number {
  return conservativeRunPromptTokens(prompt) + RUN_OUTPUT_TOKEN_ALLOWANCE;
}
