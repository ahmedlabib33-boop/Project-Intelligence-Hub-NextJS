import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { aiRequestFailure, readAiJson } from "../../../lib/ai/request";
import { buildControlledLetterResponse, type LetterSheet } from "../../../lib/letters/controlled-response";

export const runtime = "nodejs";
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function valueOf(row: JsonRecord, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function correspondence(project: JsonRecord): LetterSheet[] {
  const letters = record(record(project.features).letters_intelligence);
  return rows(record(letters.workbook_tables).sheets).map((sheet) => ({ name: String(sheet.name || ""), rows: rows(sheet.rows) }));
}
function clauses(project: JsonRecord) {
  const claims = record(record(project.features).contract_claims);
  const tables = record(record(claims.knowledge_base).tables);
  return rows(record(tables.contract_clauses).rows);
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`letters-response:${req.headers.get("x-forwarded-for") || "local"}`, 8);
  if (!limit.allowed) return NextResponse.json({ error: "Too many draft requests." }, { status: 429 });
  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const reference = sanitizeText(body?.reference, 180);
    if (!projectKey || !reference) return NextResponse.json({ error: "projectKey and consultant letter reference are required." }, { status: 400 });
    const project = await getProjectData(projectKey);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const letterSheets = correspondence(project);
    const incoming = letterSheets.filter((sheet) => /from (consultant|ace)/i.test(sheet.name)).flatMap((sheet) => sheet.rows)
      .find((row) => valueOf(row, ["Ref No", "Reference", "reference"]) === reference);
    if (!incoming) return NextResponse.json({ error: "The selected reference is not a published consultant letter for this project." }, { status: 404 });

    return NextResponse.json(buildControlledLetterResponse({ project, incoming, letterSheets, sourceClauses: clauses(project) }));
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "The controlled response draft could not be produced." }, { status: 500 });
  }
}
