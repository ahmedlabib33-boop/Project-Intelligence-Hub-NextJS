import { NextRequest, NextResponse } from "next/server";
import { askGroq } from "@/lib/groq";
import { getProjectData } from "@/lib/project-data";

const DELAY_PROMPT = `You are a construction delay analyst specializing in Time Impact Analysis (TIA).
Review the provided delay data and identify:
- Delay events and their descriptions
- Critical path impact assessment
- Recovery schedule options
- Risk exposure and recommended actions
Respond in JSON with keys: "delayEvents", "criticalPathImpact", "recoveryOptions", "riskExposure".
If no delay data is available, state that clearly. Output ONLY valid JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    const project = projectId ? await getProjectData(projectId) : null;

    const delayData = project?.delay_analysis || project?.tia || {
      note: "No detailed delay data available.",
    };

    const context = JSON.stringify(delayData, null, 2);
    const result = await askGroq(DELAY_PROMPT, context);

    let parsed = null;
    try {
      parsed = JSON.parse(result.answer);
    } catch {
      parsed = { delayEvents: [], criticalPathImpact: result.answer, recoveryOptions: [], riskExposure: "Unknown" };
    }

    return NextResponse.json({
      ...parsed,
      provider: result.provider,
      model: result.model,
      status: result.status,
    });
  } catch (err: any) {
    console.error("Delay analysis error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
