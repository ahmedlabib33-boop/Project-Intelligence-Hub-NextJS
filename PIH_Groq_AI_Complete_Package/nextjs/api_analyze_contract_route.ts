import { NextRequest, NextResponse } from "next/server";
import { askGroq } from "@/lib/groq";
import { getProjectData } from "@/lib/project-data";

const CONTRACT_PROMPT = `You are a FIDIC and construction contract specialist.
Analyze the provided contract data and identify:
- Contract position summary
- Key clauses relevant to claims
- Claim exposure assessment
- Recommendations for the project team
Respond in JSON with keys: "summary", "keyClauses", "claimExposure", "recommendations".
If no contract data is available, state that clearly. Output ONLY valid JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { projectId, clauseQuery } = await req.json();
    const project = projectId ? await getProjectData(projectId) : null;

    const contractData = project?.contracts || project?.contract_data || {
      note: "No detailed contract data available.",
      query: clauseQuery || "General contract review",
    };

    const context = JSON.stringify(contractData, null, 2);
    const result = await askGroq(CONTRACT_PROMPT, context);

    let parsed = null;
    try {
      parsed = JSON.parse(result.answer);
    } catch {
      parsed = { summary: result.answer, keyClauses: [], claimExposure: "Unknown", recommendations: [] };
    }

    return NextResponse.json({
      ...parsed,
      provider: result.provider,
      model: result.model,
      status: result.status,
    });
  } catch (err: any) {
    console.error("Contract analysis error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
