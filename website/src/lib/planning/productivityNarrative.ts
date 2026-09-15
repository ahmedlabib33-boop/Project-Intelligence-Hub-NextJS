import type { ActivityBasis } from "./library";

/**
 * Plain-language explanation of an activity's productivity range.
 *
 * This is a deterministic template today — it does not call any language
 * model. It exists as the single call site the Zero-Cost LLM Gateway
 * (see zero-cost-llm-gateway/docs/spec.md) will be wired into once it has
 * a live provider adapter (spec Phase 1+; only Phase 0 — the policy
 * schema and firewall — exists so far). Swapping the body to call the
 * Gateway later should not require touching any caller of this function.
 *
 * Never invents a number: every value it prints comes straight from
 * `basis.productivityRange`, which itself is computed only from crew and
 * equipment configurations actually recorded in the planning library.
 */
export function explainProductivityRange(basis: ActivityBasis): string {
  const range = basis.productivityRange;
  if (!range) {
    return `${basis.code}: no recorded crew or equipment productivity is available in the planning library for this activity.`;
  }
  if (range.sampleCount === 1) {
    return `${basis.code}: one recorded configuration (${range.sources[0]}) gives ${range.median} ${basis.uom || "units"}/day. No range is available yet — a second recorded configuration would be needed to show a spread.`;
  }
  return (
    `${basis.code}: ${range.sampleCount} recorded configurations in the planning library range from ${range.min} to ${range.max} ` +
    `${basis.uom || "units"}/day (typical ${range.median}). Slowest: matches the governing rate used for scheduling; fastest: ${range.sources[range.sources.length - 1]}.`
  );
}
