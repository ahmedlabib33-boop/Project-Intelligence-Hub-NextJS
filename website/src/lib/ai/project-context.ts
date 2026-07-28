import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");

type JsonRecord = Record<string, unknown>;

function compact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compact(item, depth + 1));

  const source = value as JsonRecord;
  const output: JsonRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, 80)) {
    if (["rows", "inbox_files", "source_files", "evidence_files", "output_files"].includes(key) && Array.isArray(item)) {
      output[key] = item.slice(0, 10).map((entry) => compact(entry, depth + 1));
      continue;
    }
    output[key] = compact(item, depth + 1);
  }
  return output;
}

export async function getPortfolioData(): Promise<JsonRecord | null> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "portfolio.json"), "utf-8");
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return null;
  }
}

export async function getProjectData(projectKey: string): Promise<JsonRecord | null> {
  const safeKey = projectKey.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeKey) return null;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "projects", `${safeKey}.json`), "utf-8");
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return null;
  }
}

export async function buildProjectContext(projectKey?: string, mode = "general") {
  if (projectKey) {
    const project = await getProjectData(projectKey);
    if (!project) return null;
    const portfolio = await getPortfolioData();
    const guardrails = (portfolio?.guardrails as JsonRecord | undefined) || {};
    const projectGuardrailIssues = Array.isArray(guardrails.top_issues)
      ? guardrails.top_issues.filter((issue) => {
          const record = issue as JsonRecord;
          return record.project_key === project.project_key || record.project_id === project.project_id;
        })
      : [];
    return {
      mode,
      scope: "selected_project",
      project_key: project.project_key,
      project_id: project.project_id,
      project_display_name: project.project_display_name,
      sector: project.sector,
      status: project.status,
      last_updated: project.last_updated,
      metrics: {
        contract_value: project.contract_value,
        paid_amount: project.paid_amount,
        spent_amount: project.spent_amount,
        remaining_value: project.remaining_value,
        planned_progress: project.planned_progress,
        actual_progress: project.actual_progress,
        progress_variance: project.progress_variance,
        spi: project.spi,
        cpi: project.cpi,
        risk_score: project.risk_score,
        delay_days: project.delay_days,
        claims_exposure: project.claims_exposure,
        schedule_health: project.schedule_health,
        cost_health: project.cost_health,
        delay_exposure: project.delay_exposure,
        claim_exposure_level: project.claim_exposure_level,
        data_confidence: project.data_confidence,
        decision_priority: project.decision_priority,
        decision_reasons: project.decision_reasons,
        data_quality: project.data_quality,
        decision_required: project.decision_required
      },
      source_files: project.source_files,
      guardrails: {
        status: guardrails.status,
        mode: guardrails.mode,
        issue_count: guardrails.issue_count,
        selected_project_issues: compact(projectGuardrailIssues)
      },
      features: compact(project.features)
    };
  }

  const portfolio = await getPortfolioData();
  if (!portfolio) return null;
  return {
    mode,
    scope: "portfolio",
    generated_at: portfolio.generated_at,
    project_count: portfolio.project_count,
    sector_count: portfolio.sector_count,
    totals: portfolio.totals,
    warning_summary: portfolio.warning_summary,
    guardrails: compact(portfolio.guardrails),
    decision_brief: compact(portfolio.decision_brief),
    sectors: compact(portfolio.sectors),
    projects: compact(portfolio.projects)
  };
}

export function contextToPrompt(context: unknown): string {
  return JSON.stringify(context, null, 2).slice(0, 4500);
}
