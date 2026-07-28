import { NextRequest, NextResponse } from "next/server";
import { askGroq } from "@/lib/groq";
import { getProjectData, getPortfolioData } from "@/lib/project-data";

const SYSTEM_PROMPT = `You are SAMCO's Executive Project Intelligence Analyst.
You analyze construction project data including EVM (SPI, CPI), delays, risks,
contracts, and correspondence. Answer concisely in executive language.
If data is insufficient, say so honestly. Always cite the data source
in your reasoning.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, projectId, sector } = body;

    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    let context = "";
    if (projectId) {
      const project = await getProjectData(projectId);
      if (project) {
        context = `Project: ${project.project_name || projectId}
Status: ${project.status || "Unknown"}
Progress: ${project.progress || "N/A"}%
SPI: ${project.spi || "N/A"}
CPI: ${project.cpi || "N/A"}
Contract Value: ${project.contract_value || "N/A"}
Sector: ${sector || project.sector || "N/A"}
Decisions Required: ${project.decisions_required || 0}
Risks: ${project.risk_count || 0}
Letters: ${project.letter_count || 0}`;
      }
    } else {
      const portfolio = await getPortfolioData();
      if (portfolio) {
        context = `Portfolio Overview:
Projects: ${portfolio.projects?.length || 0}
Sectors: ${portfolio.sectors?.length || 0}
Total Value: ${portfolio.total_contract_value || "N/A"}
Average Progress: ${portfolio.average_progress || "N/A"}%
Average SPI: ${portfolio.average_spi || "N/A"}
Average CPI: ${portfolio.average_cpi || "N/A"}`;
      }
    }

    const userPrompt = context
      ? `Context:
${context}

Question: ${question}`
      : question;

    const result = await askGroq(SYSTEM_PROMPT, userPrompt);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Ask AI error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err.message },
      { status: 500 }
    );
  }
}
