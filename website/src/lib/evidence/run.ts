/**
 * Client side of evidence intelligence: sends excerpts to the analysis route
 * one by one, respects rate limits, can be stopped, and turns the route's
 * answers into cited items.
 */

import type { EvidenceChunk, ExtractedItem } from "./intelligence";
import { retrieve } from "./intelligence";

const ROUTE = "/api/evidence-intelligence";

export type AiHealth = {
  state: "checking" | "wired" | "not-wired";
  provider: string;
  extractionModel: string | null;
  reasoningModel: string | null;
  detail: string;
};

export const AI_CHECKING: AiHealth = { state: "checking", provider: "", extractionModel: null, reasoningModel: null, detail: "Checking the language model connection…" };

export async function checkEvidenceAi(): Promise<AiHealth> {
  try {
    const response = await fetch(ROUTE, { cache: "no-store" });
    if (!response.ok) {
      return { ...AI_CHECKING, state: "not-wired", detail: `The analysis route is not available on this deployment (HTTP ${response.status}).` };
    }
    const data = (await response.json()) as { configured?: boolean; provider?: string; extractionModel?: string | null; reasoningModel?: string | null };
    if (!data.configured) {
      return { ...AI_CHECKING, state: "not-wired", provider: "none", detail: "No language model key is configured on the server (GROQ_API_KEY or OPENAI_API_KEY)." };
    }
    return {
      state: "wired", provider: data.provider || "", extractionModel: data.extractionModel || null, reasoningModel: data.reasoningModel || null,
      detail: `Connected to ${data.provider} — extraction ${data.extractionModel}, brief and answers ${data.reasoningModel}.`,
    };
  } catch {
    return { ...AI_CHECKING, state: "not-wired", detail: "The analysis route could not be reached." };
  }
}

type RouteReply = Record<string, unknown> & { status?: string; error?: string };

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<RouteReply> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await response.json().catch(() => ({ status: "error", error: `HTTP ${response.status}` }))) as RouteReply;
    if (response.status === 429 && attempt < 5) {
      const wait = Number(response.headers.get("Retry-After")) * 1000 || 6000 * (attempt + 1);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Stopped", "AbortError"));
        }, { once: true });
      });
      continue;
    }
    if (!response.ok || data.status !== "success") throw new Error(data.error || `The analysis route answered HTTP ${response.status}.`);
    return data;
  }
}

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

let itemCounter = 0;
const itemId = () => `E${(++itemCounter).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

export type ExtractProgress = { done: number; total: number; items: number; unverified: number; failed: number; current: string; lastError: string };

/** Extract items from every excerpt, streaming them back as each excerpt finishes. */
export async function extractFromChunks(
  chunks: EvidenceChunk[],
  onItems: (items: ExtractedItem[], chunk: EvidenceChunk) => void,
  onProgress: (p: ExtractProgress) => void,
  signal?: AbortSignal,
): Promise<ExtractProgress> {
  const progress: ExtractProgress = { done: 0, total: chunks.length, items: 0, unverified: 0, failed: 0, current: "", lastError: "" };
  for (const chunk of chunks) {
    if (signal?.aborted) break;
    progress.current = `${chunk.docName} · ${chunk.location}`;
    onProgress({ ...progress });
    try {
      const reply = await post({ action: "extract", text: chunk.text, docName: chunk.docName, location: chunk.location }, signal);
      const model = String(reply.model || "");
      const base = { docId: chunk.docId, docName: chunk.docName, location: chunk.location, source: "ai" as const, model };
      const items: ExtractedItem[] = [
        ...rows(reply.facts).map((f) => ({
          ...base, id: itemId(), kind: "fact" as const, category: String(f.category), field: String(f.field), value: String(f.value),
          quote: String(f.quote), confidence: Number(f.confidence) || 0, verified: f.verified === true,
        })),
        ...rows(reply.requirements).map((r) => ({
          ...base, id: itemId(), kind: "requirement" as const, category: String(r.type), field: "requirement", value: String(r.requirement),
          quote: String(r.quote), confidence: Number(r.confidence) || 0, verified: r.verified === true,
        })),
        ...rows(reply.milestones).map((m) => ({
          ...base, id: itemId(), kind: "milestone" as const, category: "milestone", field: "milestone", value: String(m.name), date: String(m.date || ""),
          quote: String(m.quote), confidence: 0.8, verified: m.verified === true,
        })),
        ...rows(reply.parties).map((p) => ({
          ...base, id: itemId(), kind: "party" as const, category: String(p.role || "party"), field: "party", value: String(p.name),
          quote: String(p.quote), confidence: 0.8, verified: p.verified === true,
        })),
      ];
      progress.items += items.length;
      progress.unverified += Number(reply.unverified) || 0;
      onItems(items, chunk);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") break;
      progress.failed++;
      progress.lastError = cause instanceof Error ? cause.message : "Extraction failed.";
    }
    progress.done++;
    onProgress({ ...progress });
  }
  progress.current = "";
  return progress;
}

export type Brief = {
  brief: string;
  main_requirements: { type: string; requirement: string; item_ids: string[] }[];
  key_dates: { name: string; date: string; item_ids: string[] }[];
  gaps: string[];
  model: string;
  generatedAt: string;
};

export async function writeBrief(items: ExtractedItem[], signal?: AbortSignal): Promise<Brief> {
  const lines = items.map((i) => `${i.id} | ${i.kind} | ${i.kind === "fact" ? i.field : i.category} | ${i.value}${i.date ? ` (${i.date})` : ""} | ${i.docName}`);
  let text = "";
  for (const line of lines) {
    if (text.length + line.length > 38_000) break;
    text += `${line}\n`;
  }
  const reply = await post({ action: "brief", items: text }, signal);
  return {
    brief: String(reply.brief || ""),
    main_requirements: rows(reply.main_requirements).map((r) => ({ type: String(r.type), requirement: String(r.requirement), item_ids: (r.item_ids as string[]) || [] })),
    key_dates: rows(reply.key_dates).map((d) => ({ name: String(d.name), date: String(d.date), item_ids: (d.item_ids as string[]) || [] })),
    gaps: Array.isArray(reply.gaps) ? (reply.gaps as unknown[]).map(String) : [],
    model: String(reply.model || ""),
    generatedAt: new Date().toISOString(),
  };
}

export type Answer = { question: string; answer: string; excerpts: EvidenceChunk[]; model: string; at: string };

export async function askEvidence(question: string, chunks: EvidenceChunk[], signal?: AbortSignal): Promise<Answer> {
  const excerpts = retrieve(chunks, question);
  const text = excerpts.map((c, i) => `[E${i + 1}] ${c.docName} · ${c.location}\n${c.text}`).join("\n\n");
  const reply = await post({ action: "ask", question, excerpts: text }, signal);
  return { question, answer: String(reply.answer || ""), excerpts, model: String(reply.model || ""), at: new Date().toISOString() };
}
