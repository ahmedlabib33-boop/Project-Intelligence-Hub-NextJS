import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../../lib/ai/project-context";
import { sanitizeText } from "../../../../lib/ai/provider";
import { checkRateLimit } from "../../../../lib/ai/rate-limit";
import { withSamcoDirectorPrompt } from "../../../../lib/ai/samco-director";
import { loadQuestionBank, localTechnicalAnswer, searchQuestionBank } from "../../../../lib/technical-knowledge";

export const runtime = "nodejs";

const SYSTEM_PROMPT = withSamcoDirectorPrompt(`You are SAMCO's Technical Knowledge Advisor for executive project controls and engineering decisions.
Use only the supplied technical question bank matches and project/portfolio data context.
If project evidence does not prove a fact, mark it as guidance only and not confirmed by project evidence.
Return ONLY valid JSON with keys:
answer, matchedQuestions, departments, evidenceRequired, owners, impactAreas, recommendedActions, followUpQuestions, sourceScope.
Do not fabricate dates, costs, delay days, clauses, activity status, or evidence.`);

function parseStructured(answer: string, fallback: ReturnType<typeof localTechnicalAnswer>, meta: { provider: string; model: string; status: string; latencyMs?: number }) {
  try {
    const parsed = JSON.parse(answer);
    return {
      answer: String(parsed.answer || fallback.answer),
      matchedQuestions: Array.isArray(parsed.matchedQuestions) ? parsed.matchedQuestions : fallback.matchedQuestions,
      departments: Array.isArray(parsed.departments) ? parsed.departments.map(String).slice(0, 8) : fallback.departments,
      evidenceRequired: Array.isArray(parsed.evidenceRequired) ? parsed.evidenceRequired.map(String).slice(0, 10) : fallback.evidenceRequired,
      owners: Array.isArray(parsed.owners) ? parsed.owners.map(String).slice(0, 8) : fallback.owners,
      impactAreas: Array.isArray(parsed.impactAreas) ? parsed.impactAreas.map(String).slice(0, 8) : fallback.impactAreas,
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.map(String).slice(0, 10) : fallback.recommendedActions,
      followUpQuestions: Array.isArray(parsed.followUpQuestions) ? parsed.followUpQuestions.map(String).slice(0, 8) : fallback.followUpQuestions,
      sourceScope: String(parsed.sourceScope || fallback.sourceScope),
      ...meta
    };
  } catch {
    return { ...fallback, ...meta };
  }
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`technical:${req.headers.get("x-forwarded-for") || "local"}`, 8);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many technical advisor requests. Please retry shortly." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const question = sanitizeText(body?.question, 2200);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const mode = sanitizeText(body?.mode, 30) === "project" ? "project" : "portfolio";
    const department = sanitizeText(body?.department, 160);
    const answerStyle = sanitizeText(body?.answerStyle, 80) || "Executive answer";

    if (!question) return NextResponse.json({ error: "Question is required." }, { status: 400 });
    if (mode === "project" && !projectKey) return NextResponse.json({ error: "projectKey is required in project mode." }, { status: 400 });

    const bank = await loadQuestionBank();
    const matched = searchQuestionBank(bank.records, question, { department, limit: 8 });
    const sourceScope = mode === "project" ? `selected project: ${projectKey}` : "portfolio / Decision Making Dashboard";
    const fallback = localTechnicalAnswer({ question, matched, sourceScope });
    const context = await buildProjectContext(mode === "project" ? projectKey : undefined, `technical-knowledge:${answerStyle}`);

    if (!context) {
      return NextResponse.json({ ...fallback, sourceScope, status: "fallback", provider: "local", model: "technical-question-bank" });
    }

    const prompt = `Question:\n${question}\n\nAnswer style:\n${answerStyle}\n\nSource scope:\n${sourceScope}\n\nMatched technical bank questions:\n${JSON.stringify(matched, null, 2)}\n\nProject or portfolio data:\n${contextToPrompt(context)}`;
    const result = await askConfiguredAI(SYSTEM_PROMPT, prompt, { json: true, maxTokens: 1800, temperature: 0.2 });
    if (result.status !== "success") {
      return NextResponse.json({ ...fallback, provider: result.provider, model: result.model, status: result.status });
    }
    return NextResponse.json(parseStructured(result.answer, fallback, {
      provider: result.provider,
      model: result.model,
      status: result.status,
      latencyMs: result.latencyMs
    }));
  } catch {
    return NextResponse.json({ error: "Technical Knowledge Advisor failed." }, { status: 500 });
  }
}


