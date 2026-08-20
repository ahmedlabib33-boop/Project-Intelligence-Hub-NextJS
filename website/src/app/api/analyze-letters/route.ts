import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt, getProjectData } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";
import { aiRequestFailure, aiTextList, readAiJson } from "../../../lib/ai/request";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are a construction claims correspondence analyst.
Review only the selected project's letters intelligence context.
Return ONLY valid JSON with keys: themes, criticalLetters, actionItems, deadlines.
Each key must be an array of concise strings. If no letters exist, return empty arrays and explain in themes.`);

function parseListResponse(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      themes: aiTextList(parsed.themes),
      criticalLetters: aiTextList(parsed.criticalLetters),
      actionItems: aiTextList(parsed.actionItems),
      deadlines: aiTextList(parsed.deadlines)
    };
  } catch {
    return { themes: [answer], criticalLetters: [], actionItems: [], deadlines: [] };
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function fieldValue(row: JsonRecord, names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function unique(values: string[], limit = 5): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function sourceBackedLettersFallback(project: JsonRecord) {
  const features = asRecord(project.features);
  const letters = asRecord(features.letters_intelligence);
  const workbookTables = asRecord(letters.workbook_tables);
  const sheets = Array.isArray(workbookTables.sheets) ? workbookTables.sheets.map(asRecord) : [];
  const rows = sheets.flatMap((sheet) => Array.isArray(sheet.rows) ? sheet.rows.map(asRecord) : []);
  const registerRows = sheets.reduce((total, sheet) => total + Number(sheet.row_count || 0), 0);
  const critical = rows.filter((row) => /^(high|critical)$/i.test(fieldValue(row, ["Delay Risk", "delay_risk", "Risk Level"])));
  return {
    themes: [
      `Published correspondence register: ${registerRows || rows.length} rows across ${sheets.length} letter tables.`,
      critical.length ? `${critical.length} published high/critical delay-risk records are visible in the register.` : "No high/critical delay-risk label is published in the visible correspondence rows."
    ],
    criticalLetters: unique(critical.map((row) => {
      const reference = fieldValue(row, ["Ref No", "Reference", "reference"]);
      const subject = fieldValue(row, ["Subject", "subject", "Main Purpose"]);
      return `${reference || "Unreferenced letter"}${subject ? ` — ${subject}` : ""}`;
    })),
    actionItems: unique(rows.map((row) => fieldValue(row, ["Required Actions", "Required Action", "Action", "action_items"]))),
    deadlines: [],
    provider: "source-backed",
    model: "published correspondence register",
    status: "fallback",
    notice: "The external AI provider is unavailable. This is a deterministic screening of the selected project's published letters CSV; verify the register before acting."
  };
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`letters:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const context = await buildProjectContext(projectKey, "letters");
    if (!context) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const result = await askConfiguredAI(PROMPT, contextToPrompt(context), { json: true, maxTokens: 1400, temperature: 0.2 });
    if (result.status !== "success") {
      const project = await getProjectData(projectKey);
      if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      return NextResponse.json({ ...sourceBackedLettersFallback(project), latencyMs: result.latencyMs });
    }
    return NextResponse.json({ ...parseListResponse(result.answer), provider: result.provider, model: result.model, status: result.status, latencyMs: result.latencyMs });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "Letters analysis failed." }, { status: 500 });
  }
}


