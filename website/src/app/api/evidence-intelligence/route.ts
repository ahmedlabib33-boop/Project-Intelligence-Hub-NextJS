import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "../../../lib/ai/env";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { currentGroqModel, GROQ_MODEL_PRIMARY } from "../../../lib/ai/groq";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { aiRequestFailure, readAiJson } from "../../../lib/ai/request";

/**
 * Evidence intelligence — reads project documents with the Hub's configured
 * language model.
 *
 * `extract` pulls facts, requirements, milestones and parties out of one text
 * excerpt. Every item must carry an exact quote, and the server checks that the
 * quote really occurs in the excerpt: an item whose quote cannot be found is
 * returned as unverified, never as a fact. `brief` writes the project brief
 * from items the user can see; `ask` answers questions from supplied excerpts
 * with citations.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 60_000;
const REASONING_MODEL = currentGroqModel(getServerEnv("GROQ_MODEL_REASONING") || "openai/gpt-oss-120b");

const CATEGORIES = ["identity", "parties", "contract", "commercial", "dates", "duration", "scope", "location", "technical", "schedule", "quality", "hse", "legal", "other"];
const REQUIREMENT_TYPES = ["contractual", "technical", "schedule", "commercial", "quality", "hse", "submittal", "approval", "reporting", "other"];

const EXTRACT_PROMPT = `You read construction and engineering project documents — contracts, tenders, specifications, BOQs, letters, minutes, schedules, registers — in English or Arabic, and extract what they state.
Return ONLY a JSON object of exactly this shape:
{"facts":[{"category":"","field":"","value":"","quote":"","confidence":0}],
 "requirements":[{"type":"","requirement":"","quote":"","confidence":0}],
 "milestones":[{"name":"","date":"","quote":""}],
 "parties":[{"role":"","name":"","quote":""}]}
Rules:
- Use only what the text states. Never infer, estimate, convert or complete a value that is not written. If nothing relevant is present, return empty arrays.
- Do not turn individual rows of a table (activity lists, BOQ lines, registers, logs) into separate facts; extract only project-level facts, requirements and milestones from tables.
- "quote" is an exact excerpt copied character for character from the text (at most 200 characters) that proves the item.
- category is one of: ${CATEGORIES.join(", ")}.
- field is a short snake_case name, e.g. project_name, project_code, employer, contractor, consultant, contract_type, contract_value, currency, commencement_date, completion_date, contract_duration, delay_damages, advance_payment, retention, performance_bond, defects_liability_period, payment_terms, site_location, scope_summary, working_hours, working_days, key_constraint.
- requirement type is one of: ${REQUIREMENT_TYPES.join(", ")}. A requirement is an obligation, condition or specification the project must satisfy.
- Keep Arabic text in Arabic. confidence is between 0 and 1: how explicitly the text states the item.`;

const BRIEF_PROMPT = `You write a project brief for a planning engineer from items already extracted from the project's documents.
Return ONLY a JSON object: {"brief":"","main_requirements":[{"type":"","requirement":"","item_ids":[]}],"key_dates":[{"name":"","date":"","item_ids":[]}],"gaps":[""]}
Rules:
- Use only the supplied items. Every requirement and date must list the ids of the items it rests on.
- The brief is 5 to 8 sentences: what the project is, who the parties are, contract value and dates where stated, the scope, and the most important obligations.
- "gaps" lists main project data the items do not contain (for example completion date, contract value, delay damages). Do not guess them.
- Write in the language most of the items use.`;

const ASK_PROMPT = `You answer questions about a construction project using only the supplied document excerpts.
Cite every statement with the excerpt reference in square brackets, e.g. [E3]. If the excerpts do not contain the answer, say exactly that and name what document would be needed. Never use outside knowledge about the project.
Answer in the language of the question, concisely.`;

type Json = Record<string, unknown>;

function rateKey(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function clip(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Normalise for quote matching: case, whitespace, Arabic letter variants, diacritics and tatweel. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[“”«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteFound(quote: string, source: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 3) return false;
  const s = normalizeForMatch(source);
  if (s.includes(q)) return true;
  // Models sometimes trim the ends of a long quote; accept a solid contiguous core.
  if (q.length >= 40) {
    const core = q.slice(Math.floor(q.length * 0.15), Math.ceil(q.length * 0.85));
    return core.length >= 30 && s.includes(core);
  }
  return false;
}

function parseModelJson(answer: string): Json | null {
  try {
    const parsed = JSON.parse(answer);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    const match = answer.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Json;
    } catch {
      return null;
    }
  }
}

const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((x): x is Json => !!x && typeof x === "object" && !Array.isArray(x)) : [];

function aiFailure(result: { error?: string; answer: string }) {
  const message = result.error || result.answer || "The language model did not answer.";
  const status = /rate limit/i.test(message) ? 429 : /not configured|missing/i.test(message) ? 503 : 502;
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function GET() {
  const groq = Boolean(getServerEnv("GROQ_API_KEY"));
  const openai = Boolean(getServerEnv("OPENAI_API_KEY"));
  // Health must not spend model tokens.
  return NextResponse.json({
    configured: groq || openai,
    provider: groq ? "groq" : openai ? "openai" : "none",
    extractionModel: groq ? GROQ_MODEL_PRIMARY : openai ? "openai default" : null,
    reasoningModel: groq ? REASONING_MODEL : openai ? "openai default" : null,
  });
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`evidence:${rateKey(req)}`, 90);
  if (!limit.allowed) {
    return NextResponse.json({ status: "error", error: "Too many analysis requests. Please retry shortly." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter) },
    });
  }

  try {
    const body = await readAiJson(req, MAX_BODY);
    const action = clip(body.action, 20);

    if (action === "extract") {
      const text = String(body.text ?? "").slice(0, 16_000);
      const docName = clip(body.docName, 200);
      const location = clip(body.location, 120);
      if (text.trim().length < 20) {
        return NextResponse.json({ status: "success", facts: [], requirements: [], milestones: [], parties: [], unverified: 0, model: "none" });
      }
      const result = await askConfiguredAI(
        EXTRACT_PROMPT,
        `Document: ${docName}\nLocation: ${location}\n\nText:\n"""\n${text}\n"""`,
        { json: true, maxTokens: 2400, temperature: 0 },
      );
      if (result.status !== "success") return aiFailure(result);
      const parsed = parseModelJson(result.answer);
      if (!parsed) return NextResponse.json({ status: "error", error: "The model returned text that is not valid JSON." }, { status: 502 });

      let unverified = 0;
      const verify = (quote: string) => {
        const ok = quoteFound(quote, text);
        if (!ok) unverified++;
        return ok;
      };
      const confidence = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
      };

      const facts = list(parsed.facts).map((f) => {
        const quote = clip(f.quote, 240);
        const category = clip(f.category, 30).toLowerCase();
        return {
          category: CATEGORIES.includes(category) ? category : "other",
          field: clip(f.field, 60).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed",
          value: clip(f.value, 400),
          quote,
          confidence: confidence(f.confidence),
          verified: verify(quote),
        };
      }).filter((f) => f.value);

      const requirements = list(parsed.requirements).map((r) => {
        const quote = clip(r.quote, 240);
        const type = clip(r.type, 30).toLowerCase();
        return {
          type: REQUIREMENT_TYPES.includes(type) ? type : "other",
          requirement: clip(r.requirement, 500),
          quote,
          confidence: confidence(r.confidence),
          verified: verify(quote),
        };
      }).filter((r) => r.requirement);

      const milestones = list(parsed.milestones).map((m) => {
        const quote = clip(m.quote, 240);
        return { name: clip(m.name, 200), date: clip(m.date, 60), quote, verified: verify(quote) };
      }).filter((m) => m.name);

      const parties = list(parsed.parties).map((p) => {
        const quote = clip(p.quote, 240);
        return { role: clip(p.role, 60), name: clip(p.name, 200), quote, verified: verify(quote) };
      }).filter((p) => p.name);

      return NextResponse.json({
        status: "success", provider: result.provider, model: result.model, latencyMs: result.latencyMs,
        facts, requirements, milestones, parties, unverified,
      });
    }

    if (action === "brief") {
      const items = String(body.items ?? "").slice(0, 40_000);
      if (!items.trim()) return NextResponse.json({ status: "error", error: "No extracted items to write a brief from." }, { status: 400 });
      const result = await askConfiguredAI(BRIEF_PROMPT, `Extracted items (id | kind | field or type | value | document):\n${items}`, {
        json: true, maxTokens: 2000, temperature: 0.1, model: REASONING_MODEL,
      });
      if (result.status !== "success") return aiFailure(result);
      const parsed = parseModelJson(result.answer);
      if (!parsed) return NextResponse.json({ status: "error", error: "The model returned text that is not valid JSON." }, { status: 502 });
      return NextResponse.json({
        status: "success", provider: result.provider, model: result.model, latencyMs: result.latencyMs,
        brief: clip(parsed.brief, 4000),
        main_requirements: list(parsed.main_requirements).map((r) => ({
          type: clip(r.type, 30), requirement: clip(r.requirement, 500),
          item_ids: Array.isArray(r.item_ids) ? r.item_ids.map((x) => clip(x, 20)).slice(0, 12) : [],
        })),
        key_dates: list(parsed.key_dates).map((d) => ({
          name: clip(d.name, 200), date: clip(d.date, 60),
          item_ids: Array.isArray(d.item_ids) ? d.item_ids.map((x) => clip(x, 20)).slice(0, 12) : [],
        })),
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map((g) => clip(g, 300)).filter(Boolean).slice(0, 30) : [],
      });
    }

    if (action === "ask") {
      const question = clip(body.question, 1500);
      const excerpts = String(body.excerpts ?? "").slice(0, 45_000);
      if (!question) return NextResponse.json({ status: "error", error: "Question is required." }, { status: 400 });
      if (!excerpts.trim()) {
        return NextResponse.json({ status: "success", answer: "No uploaded document contains text related to this question.", model: "none" });
      }
      const result = await askConfiguredAI(ASK_PROMPT, `Excerpts:\n${excerpts}\n\nQuestion: ${question}`, {
        maxTokens: 1400, temperature: 0.1, model: REASONING_MODEL,
      });
      if (result.status !== "success") return aiFailure(result);
      return NextResponse.json({ status: "success", provider: result.provider, model: result.model, latencyMs: result.latencyMs, answer: result.answer.slice(0, 8000) });
    }

    return NextResponse.json({ status: "error", error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ status: "error", error: failure.error }, { status: failure.status });
    return NextResponse.json({ status: "error", error: "Evidence analysis failed. Please retry." }, { status: 500 });
  }
}
