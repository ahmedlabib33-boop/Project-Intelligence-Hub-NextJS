"use client";

import { useState } from "react";

type SearchResponse = {
  answer?: string;
  matchedSources?: Array<{ title: string; source: string; detail: string }>;
  matchedQuestions?: Array<{ question: string; department?: string; score?: number }>;
  recommendedActions?: string[];
  followUpQuestions?: string[];
  sourceScope?: string;
  provider?: string;
  model?: string;
  status?: string;
  error?: string;
};

export default function UnifiedIntelligenceSearch({
  mode,
  projectKey,
  projectName
}: {
  mode: "portfolio" | "project";
  projectKey?: string;
  projectName?: string;
}) {
  const [question, setQuestion] = useState("");
  const [answerStyle, setAnswerStyle] = useState("Executive answer");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);

  async function ask() {
    if (!question.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/intelligence/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode, projectKey, answerStyle })
      });
      setResult(await response.json());
    } catch {
      setResult({ error: "Unified intelligence search failed." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass-panel unified-intelligence-search">
      <div className="section-header">
        <div>
          <p className="eyebrow">Search All Project Intelligence</p>
          <h2>{mode === "portfolio" ? "Portfolio Intelligence Search" : `${projectName || "Project"} Intelligence Search`}</h2>
        </div>
        <span>{mode === "portfolio" ? "Portfolio scope" : "Project scope"}</span>
      </div>
      <div className="advisor-form">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about risks, delays, contracts, letters, evidence, technical issues, or management decisions..."
        />
        <div className="advisor-controls">
          <select value={answerStyle} onChange={(event) => setAnswerStyle(event.target.value)}>
            <option>Executive answer</option>
            <option>Engineering checklist</option>
            <option>Site action plan</option>
            <option>Delay / claim support</option>
            <option>Learning / training explanation</option>
          </select>
          <button type="button" onClick={ask} disabled={loading}>{loading ? "Searching..." : "Search intelligence"}</button>
        </div>
      </div>
      {result && (
        <div className="technical-answer">
          <h3>{result.error ? "Search unavailable" : "Answer"}</h3>
          <p>{result.error || result.answer}</p>
          {!!result.matchedSources?.length && (
            <div className="matched-question-bank">
              {result.matchedSources.map((source, index) => (
                <article key={`${source.title}-${index}`}>
                  <span>{source.source}</span>
                  <p><b>{source.title}</b> - {source.detail}</p>
                </article>
              ))}
            </div>
          )}
          {!!result.recommendedActions?.length && <ul>{result.recommendedActions.map((item) => <li key={item}>{item}</li>)}</ul>}
          <small>{result.sourceScope || mode} | {result.provider || "local"} / {result.model || "deterministic"}</small>
        </div>
      )}
    </section>
  );
}
