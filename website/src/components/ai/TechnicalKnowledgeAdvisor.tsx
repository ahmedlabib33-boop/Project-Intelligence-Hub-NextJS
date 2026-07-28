"use client";

import { useState } from "react";

type TechnicalKnowledgeAdvisorProps = {
  mode: "portfolio" | "project";
  projectKey?: string;
  projectName?: string;
};

type AdvisorResult = {
  answer?: string;
  matchedQuestions?: Array<{ id?: string; department?: string; section?: string; level?: string; question?: string; score?: number }>;
  departments?: string[];
  evidenceRequired?: string[];
  owners?: string[];
  impactAreas?: string[];
  recommendedActions?: string[];
  followUpQuestions?: string[];
  sourceScope?: string;
  provider?: string;
  model?: string;
  status?: string;
  error?: string;
};

const answerStyles = [
  "Executive answer",
  "Engineering checklist",
  "Site action plan",
  "Delay / claim support",
  "Learning / training explanation"
];

function ResultList({ title, items }: { title: string; items?: unknown[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="technical-result-list">
      <b>{title}</b>
      <ul>
        {items.slice(0, 8).map((item, index) => <li key={index}>{String(item)}</li>)}
      </ul>
    </div>
  );
}

export default function TechnicalKnowledgeAdvisor({ mode, projectKey, projectName }: TechnicalKnowledgeAdvisorProps) {
  const [question, setQuestion] = useState("");
  const [department, setDepartment] = useState("");
  const [answerStyle, setAnswerStyle] = useState(answerStyles[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdvisorResult | null>(null);

  async function askAdvisor() {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/technical-knowledge/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQuestion,
          projectKey,
          mode,
          department,
          answerStyle
        })
      });
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({ error: "Technical advisor request failed. Please retry." });
    } finally {
      setLoading(false);
    }
  }

  const scopeLabel = mode === "portfolio"
    ? "Portfolio and all recognized projects"
    : projectName || projectKey || "Selected project";

  return (
    <section className="technical-advisor-panel">
      <div className="technical-advisor-head">
        <div>
          <p className="eyebrow">Technical Knowledge Advisor</p>
          <h2>{mode === "portfolio" ? "Top-Management Technical Advisor" : "Project Technical Advisor"}</h2>
          <span>{scopeLabel}</span>
        </div>
        <div className="technical-scope-badge">{mode === "portfolio" ? "Portfolio mode" : "Project mode"}</div>
      </div>

      <div className="technical-advisor-grid">
        <label>
          <span>Question</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, 2200))}
            placeholder={mode === "portfolio"
              ? "Ask about technical decisions, risks, evidence gaps, blocked departments, or portfolio exposure..."
              : "Ask what blocks this project, what evidence is needed, or which technical questions apply..."}
          />
        </label>
        <div className="technical-controls">
          <label>
            <span>Answer mode</span>
            <select value={answerStyle} onChange={(event) => setAnswerStyle(event.target.value)}>
              {answerStyles.map((style) => <option value={style} key={style}>{style}</option>)}
            </select>
          </label>
          <label>
            <span>Department filter</span>
            <input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Optional, e.g. MEP, Planning, QA/QC" />
          </label>
          <button type="button" onClick={() => void askAdvisor()} disabled={!question.trim() || loading}>
            {loading ? "Analyzing..." : "Ask Technical Advisor"}
          </button>
        </div>
      </div>

      {result ? (
        <div className="technical-answer">
          {result.error ? <p className="ai-insight-error">{result.error}</p> : null}
          {result.answer ? <p className="technical-main-answer">{result.answer}</p> : null}
          <div className="technical-answer-grid">
            <ResultList title="Evidence required" items={result.evidenceRequired} />
            <ResultList title="Recommended actions" items={result.recommendedActions} />
            <ResultList title="Follow-up questions" items={result.followUpQuestions} />
            <ResultList title="Impact areas" items={result.impactAreas} />
          </div>
          {Array.isArray(result.matchedQuestions) && result.matchedQuestions.length ? (
            <div className="matched-question-bank">
              <b>Matched question bank guidance</b>
              {result.matchedQuestions.slice(0, 6).map((item, index) => (
                <article key={`${item.id || index}-${index}`}>
                  <span>{item.department || "Technical bank"} / {item.section || "General"} / {item.level || "General"}</span>
                  <p>{item.question}</p>
                </article>
              ))}
            </div>
          ) : null}
          <small>{result.sourceScope || scopeLabel} / {result.provider || "advisor"} / {result.model || "model unavailable"} / {result.status || "unknown"}</small>
        </div>
      ) : (
        <div className="technical-empty-state">
          <b>Ask naturally.</b>
          <span>The advisor matches your wording to the technical bank, combines more than one related question when needed, then checks the selected project or portfolio context.</span>
        </div>
      )}
    </section>
  );
}
