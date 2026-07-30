import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../../lib/ai/project-context";
import { sanitizeText } from "../../../../lib/ai/provider";
import { checkRateLimit } from "../../../../lib/ai/rate-limit";
import { withSamcoDirectorPrompt } from "../../../../lib/ai/samco-director";
import { loadQuestionBank, searchQuestionBank } from "../../../../lib/technical-knowledge";
import { aiRequestFailure, readAiJson } from "../../../../lib/ai/request";

export const runtime = "nodejs";

const SYSTEM_PROMPT = withSamcoDirectorPrompt(`You are the Project Intelligence Hub unified executive search advisor.
Use only the supplied portfolio/project JSON, metadata, source registers, technical bank matches, letters metadata, claims metadata, delay metadata, and output metadata.
Return ONLY valid JSON with keys:
answer, matchedSources, matchedQuestions, recommendedActions, followUpQuestions, sourceScope.
Do not fabricate dates, costs, delay days, clauses, activity status, evidence, or project facts.
If the context does not prove something, say what evidence is missing.`);

function tokenize(text: string) {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length > 2));
}

function findContextMatches(context: unknown, question: string) {
  const tokens = tokenize(question);
  const text = JSON.stringify(context);
  const rows: Array<{ title: string; source: string; detail: string }> = [];
  const projectContext = context as {
    scope?: string;
    project_display_name?: string;
    project_key?: string;
    metrics?: Record<string, unknown>;
    totals?: Record<string, unknown>;
    projects?: Array<Record<string, unknown>>;
    sectors?: Array<Record<string, unknown>>;
  };

  if (projectContext.metrics) {
    for (const [key, value] of Object.entries(projectContext.metrics).slice(0, 12)) {
      if (value !== null && value !== undefined && String(value) !== "") {
        rows.push({ title: key, source: projectContext.project_display_name || "selected project", detail: String(value) });
      }
    }
  }

  if (projectContext.totals) {
    for (const [key, value] of Object.entries(projectContext.totals).slice(0, 12)) {
      if (value !== null && value !== undefined && String(value) !== "") {
        rows.push({ title: key, source: "portfolio totals", detail: String(value) });
      }
    }
  }

  for (const item of [...(projectContext.projects || []), ...(projectContext.sectors || [])].slice(0, 16)) {
    const line = JSON.stringify(item);
    let score = 0;
    tokens.forEach((token) => {
      if (line.toLowerCase().includes(token)) score += 1;
    });
    if (score > 0 || rows.length < 6) {
      rows.push({
        title: String(item.project_display_name || item.sector || item.project_key || "source item"),
        source: String(item.sector || projectContext.scope || "project data"),
        detail: line.slice(0, 240)
      });
    }
  }

  if (!rows.length && text) {
    rows.push({ title: "Available context", source: projectContext.scope || "project intelligence", detail: text.slice(0, 240) });
  }
  return rows.slice(0, 10);
}

function fallbackAnswer(args: {
  question: string;
  context: unknown;
  matchedQuestions: ReturnType<typeof searchQuestionBank>;
  sourceScope: string;
}) {
  const matchedSources = findContextMatches(args.context, args.question);
  const technicalLead = args.matchedQuestions[0]?.question;
  return {
    answer: [
      `Search completed in ${args.sourceScope}.`,
      matchedSources.length ? `Matched ${matchedSources.length} project intelligence signals.` : "No direct project-data match was found.",
      technicalLead ? `Closest technical-bank guidance: ${technicalLead}` : "No close technical-bank match was found.",
      "AI synthesis is not configured, so this is a deterministic evidence match rather than a generative answer."
    ].join(" "),
    matchedSources,
    matchedQuestions: args.matchedQuestions,
    recommendedActions: [
      "Review the matched source signals before making a decision.",
      "Confirm missing evidence, owner, deadline, and impact area.",
      "Use the project deep dive for project-specific validation."
    ],
    followUpQuestions: [
      "Which project, discipline, or workfront is affected?",
      "What source file confirms the issue?",
      "What management decision is required and by when?"
    ],
    sourceScope: args.sourceScope,
    provider: "local",
    model: "deterministic-search",
    status: "fallback"
  };
}

function parseStructured(answer: string, fallback: ReturnType<typeof fallbackAnswer>, meta: { provider: string; model: string; status: string; latencyMs?: number }) {
  try {
    const parsed = JSON.parse(answer);
    return {
      answer: String(parsed.answer || fallback.answer),
      matchedSources: Array.isArray(parsed.matchedSources) ? parsed.matchedSources.slice(0, 12) : fallback.matchedSources,
      matchedQuestions: Array.isArray(parsed.matchedQuestions) ? parsed.matchedQuestions.slice(0, 8) : fallback.matchedQuestions,
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
  const limit = checkRateLimit(`unified:${req.headers.get("x-forwarded-for") || "local"}`, 10);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many intelligence search requests. Please retry shortly." }, { status: 429 });
  }

  try {
    const body = await readAiJson(req);
    const question = sanitizeText(body?.question, 2400);
    const mode = sanitizeText(body?.mode, 30) === "project" ? "project" : "portfolio";
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const answerStyle = sanitizeText(body?.answerStyle, 80) || "Executive answer";

    if (!question) return NextResponse.json({ error: "Question is required." }, { status: 400 });
    if (mode === "project" && !projectKey) return NextResponse.json({ error: "projectKey is required in project mode." }, { status: 400 });

    const context = await buildProjectContext(mode === "project" ? projectKey : undefined, `unified-search:${answerStyle}`);
    if (!context) return NextResponse.json({ error: "No project intelligence context was found for this scope." }, { status: 404 });

    const bank = await loadQuestionBank();
    const matchedQuestions = searchQuestionBank(bank.records, question, { limit: 8 });
    const sourceScope = mode === "project" ? `selected project: ${projectKey}` : "portfolio / Decision Making Dashboard";
    const fallback = fallbackAnswer({ question, context, matchedQuestions, sourceScope });

    const prompt = `Question:\n${question}\n\nAnswer style:\n${answerStyle}\n\nSource scope:\n${sourceScope}\n\nMatched technical questions:\n${JSON.stringify(matchedQuestions, null, 2)}\n\nProject intelligence context:\n${contextToPrompt(context)}`;
    const result = await askConfiguredAI(SYSTEM_PROMPT, prompt, { json: true, maxTokens: 800, temperature: 0.2 });
    if (result.status !== "success") {
      return NextResponse.json({ ...fallback, provider: result.provider, model: result.model, status: result.status });
    }
    return NextResponse.json(parseStructured(result.answer, fallback, {
      provider: result.provider,
      model: result.model,
      status: result.status,
      latencyMs: result.latencyMs
    }));
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "Unified intelligence search failed." }, { status: 500 });
  }
}


