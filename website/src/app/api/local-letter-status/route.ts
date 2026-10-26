import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StatusChange = {
  kind?: string;
  input_type?: string;
  sector?: string;
  project_folder?: string;
  direction?: string;
  file_name?: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function localRequest(request: NextRequest) {
  if (process.env.VERCEL) return false;
  const hostname = request.nextUrl.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function GET(request: NextRequest) {
  if (!localRequest(request)) {
    return NextResponse.json({ available: false }, { status: 404 });
  }

  try {
    const statusPath = path.resolve(process.cwd(), "..", ".sync_state", "local_letter_status.json");
    const raw = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
    const changes = Array.isArray(raw.changes) ? raw.changes as StatusChange[] : [];
    const changedJson = Array.isArray(raw.changed_json) ? raw.changed_json : [];
    return NextResponse.json({
      available: true,
      schema_version: Number(raw.schema_version) || 1,
      event_id: text(raw.event_id),
      mode: text(raw.mode),
      stage: text(raw.stage) || "watching",
      progress_percent: Math.max(0, Math.min(100, Number(raw.progress_percent) || 0)),
      message: text(raw.message),
      started_at: text(raw.started_at),
      updated_at: text(raw.updated_at),
      completed_at: text(raw.completed_at),
      error: text(raw.error),
      changed_json: changedJson.map(text).filter(Boolean).slice(0, 20),
      changes: changes.slice(0, 20).map((change) => ({
        kind: text(change.kind),
        input_type: text(change.input_type),
        sector: text(change.sector),
        project_folder: text(change.project_folder),
        direction: text(change.direction),
        file_name: text(change.file_name),
      })),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({
      available: true,
      event_id: "",
      mode: "automatic",
      stage: "watching",
      progress_percent: 0,
      message: "Waiting for RUN_LOCAL.bat to start the automatic letter watcher.",
      changes: [],
      changed_json: [],
      error: "",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
