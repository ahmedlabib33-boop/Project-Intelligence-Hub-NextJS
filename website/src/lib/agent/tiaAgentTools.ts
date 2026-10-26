import type { AgentTool } from "./reactLoop";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

/** Builds the Tool Sandbox over one project's controlled Time Impact
 * Analysis run (`features.delay_analysis.controlled_tia`), read directly
 * from the full project JSON rather than through the general-purpose
 * `buildProjectContext` -> `contextToPrompt` pipeline, which hard-truncates
 * its JSON dump to 4500 characters shared across every feature area. A
 * project with a large letters/contract payload can leave little or no
 * budget left for the TIA section by the time that truncation point is
 * reached -- these tools instead return one untruncated section at a time,
 * on demand, so a large controlled run is never silently cut off. */
export function buildTiaAgentTools(project: JsonRecord): { tools: AgentTool[]; controlledTia: JsonRecord } {
  const features = record(project.features);
  const delay = record(features.delay_analysis);
  const controlledTia = record(delay.controlled_tia);

  const section = (key: string) => controlledTia[key] ?? null;

  const tools: AgentTool[] = [
    {
      name: "get_run_status",
      description: "The controlled TIA run's authoritative status, approval status, message, and last run time.",
      argsHint: "{}",
      execute: () => ({
        status: controlledTia.status ?? "SETUP_REQUIRED",
        approval_status: controlledTia.approval_status ?? "not_submitted",
        message: controlledTia.message ?? null,
        last_run_at: controlledTia.last_run_at ?? null,
      }),
    },
    {
      name: "get_source_integrity",
      description: "Source package integrity: signature/hash verification, declared files, and project-match status.",
      argsHint: "{}",
      execute: () => section("source_integrity"),
    },
    {
      name: "get_schedule_cpm",
      description: "Native XER pair readiness and CPM controls (relationships, critical/longest-path indicators).",
      argsHint: "{}",
      execute: () => section("schedule_cpm"),
    },
    {
      name: "get_events_and_fragnets",
      description: "The event register and fragnet controls, including per-event native-pair availability.",
      argsHint: "{}",
      execute: () => section("events_and_fragnets"),
    },
    {
      name: "get_concurrency_and_entitlement",
      description: "Concurrency adjustment and entitlement controls, including any submitted event positions.",
      argsHint: "{}",
      execute: () => section("concurrency_and_entitlement"),
    },
    {
      name: "get_eot_position",
      description: "The current EOT position section -- an indicative, P6-verification-pending position, never a final grant.",
      argsHint: "{}",
      execute: () => section("eot_position"),
    },
    {
      name: "get_reconciliation_items",
      description: "Open reconciliation findings that block a final position (arithmetic mismatches, incomplete pairs, historic conflicts).",
      argsHint: "{}",
      execute: () => section("reconciliation_items") ?? [],
    },
    {
      name: "get_missing_evidence",
      description: "The list of evidence still required before this run could move toward a final position.",
      argsHint: "{}",
      execute: () => section("missing_evidence") ?? [],
    },
  ];

  return { tools, controlledTia };
}
