import { NextRequest, NextResponse } from "next/server";
import { askGroq } from "@/lib/groq";
import { getProjectData } from "@/lib/project-data";

const LETTERS_PROMPT = `You are a construction claims correspondence analyst.
Review the provided letter inventory and identify:
- Key themes in recent correspondence
- Claim-critical letters that may trigger notice or time-bar clauses
- Action items requiring response
- Upcoming deadlines
Respond in JSON with keys: "themes", "criticalLetters", "actionItems", "deadlines".
If no letters data is available, state that clearly. Output ONLY valid JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    const project = projectId ? await getProjectData(projectId) : null;

    const letterData = project?.letters || project?.letter_inventory || {
      count: project?.letter_count || 0,
      note: "No detailed letter data available in generated JSON.",
    };

    const context = JSON.stringify(letterData, null, 2);
    const result = await askGroq(LETTERS_PROMPT, context);

    let parsed = null;
    try {
      parsed = JSON.parse(result.answer);
    } catch {
      parsed = { themes: [], criticalLetters: [], actionItems: [result.answer], deadlines: [] };
    }

    return NextResponse.json({
      ...parsed,
      provider: result.provider,
      model: result.model,
      status: result.status,
    });
  } catch (err: any) {
    console.error("Letters analysis error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
