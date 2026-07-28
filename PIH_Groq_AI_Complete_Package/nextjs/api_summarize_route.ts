import { NextRequest, NextResponse } from "next/server";
import { askGroq } from "@/lib/groq";
import { getProjectData } from "@/lib/project-data";

const SUMMARY_PROMPT = `You are SAMCO's Executive Project Intelligence Analyst.
Given project data, generate a structured executive summary.
Respond in JSON format with these keys:
- "summary": One-paragraph executive summary (max 150 words)
- "actions": Array of 3 specific, actionable recommendations
- "risks": Array of top 3 risks or concerns
- "health": One of "Green", "Yellow", "Red" based on SPI/CPI/Status
Output ONLY valid JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await getProjectData(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const context = JSON.stringify(project, null, 2);
    const result = await askGroq(SUMMARY_PROMPT, context);

    let parsed = null;
    try {
      parsed = JSON.parse(result.answer);
    } catch {
      parsed = { summary: result.answer, actions: [], risks: [], health: "Unknown" };
    }

    return NextResponse.json({
      ...parsed,
      provider: result.provider,
      model: result.model,
      status: result.status,
    });
  } catch (err: any) {
    console.error("Summarize error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
