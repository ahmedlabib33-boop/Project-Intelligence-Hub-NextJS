"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
  status?: string;
};

type AiChatPanelProps = {
  projectKey?: string;
  projectName?: string;
  sector?: string;
};

export default function AiChatPanel({ projectKey, projectName, sector }: AiChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Ask about portfolio performance, selected project risks, delay analysis, letters, contracts, or required management actions.",
      provider: "groq",
      status: "ready"
    }
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health/ai")
      .then((response) => response.json())
      .then((data) => {
        const groq = data.providers?.find((provider: { name: string }) => provider.name === "groq");
        setStatus(groq?.available ? "online" : "offline");
      })
      .catch(() => setStatus("offline"));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: question }]);
    try {
      const response = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, projectKey, sector })
      });
      const data = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer || data.error || "No AI response was returned.",
          provider: data.provider,
          model: data.model,
          status: data.status
        }
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: "AI request failed. Please retry.", provider: "groq", status: "error" }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="ai-launcher" onClick={() => setOpen((value) => !value)}>
        <span>AI</span>
        <b>{open ? "Close" : "Ask"}</b>
        <i className={`ai-dot ${status}`} />
      </button>
      {open ? (
        <aside className="ai-chat-panel" aria-label="Project Intelligence AI">
          <div className="ai-chat-head">
            <div>
              <span>Project Intelligence AI</span>
              <b>{projectName || "Portfolio"}</b>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close AI panel">×</button>
          </div>
          <div className="ai-chat-messages">
            {messages.map((message, index) => (
              <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}>
                <p>{message.content}</p>
                {message.role === "assistant" ? (
                  <small>{message.provider || "ai"} {message.model ? `/ ${message.model}` : ""}</small>
                ) : null}
              </div>
            ))}
            {loading ? <div className="ai-message assistant"><p>Analyzing current project data...</p></div> : null}
            <div ref={endRef} />
          </div>
          <div className="ai-chat-input">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 2000))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={status === "offline"}
              placeholder={status === "offline" ? "AI is not configured on the server" : "Ask a project question..."}
            />
            <button type="button" onClick={() => void sendMessage()} disabled={!input.trim() || loading || status === "offline"}>
              Send
            </button>
          </div>
          <p className="ai-disclaimer">AI-generated output. Verify against project source data before acting.</p>
        </aside>
      ) : null}
    </>
  );
}
