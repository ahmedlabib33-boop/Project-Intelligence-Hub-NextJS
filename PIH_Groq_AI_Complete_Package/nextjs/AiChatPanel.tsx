"use client";

import React, { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Bot, User, AlertCircle, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
  status?: string;
}

interface AiChatPanelProps {
  projectId?: string;
  sector?: string;
}

export default function AiChatPanel({ projectId, sector }: AiChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I am SAMCO's Project Intelligence Analyst. Ask me about project data, risks, delays, contracts, or correspondence.",
      provider: "groq",
      status: "ready",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<"online" | "offline" | "checking">("checking");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health/ai")
      .then((r) => r.json())
      .then((data) => {
        const groq = data.providers?.find((p: any) => p.name === "groq");
        setAiStatus(groq?.available ? "online" : "offline");
      })
      .catch(() => setAiStatus("offline"));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userMsg.content, projectId, sector }),
      });

      const data = await res.json();
      const assistantMsg: Message = {
        role: "assistant",
        content: data.answer || data.error || "No response received.",
        provider: data.provider,
        model: data.model,
        status: data.status,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again.", provider: "error", status: "error" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-white shadow-lg hover:bg-slate-800 transition-all"
      >
        {isOpen ? <X size={20} /> : <MessageCircle size={20} />}
        <span className="text-sm font-medium hidden sm:inline">{isOpen ? "Close" : "Ask AI"}</span>
        {aiStatus === "online" && <span className="ml-1 h-2 w-2 rounded-full bg-green-400 animate-pulse" />}
        {aiStatus === "offline" && <span className="ml-1 h-2 w-2 rounded-full bg-red-400" />}
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 flex h-[500px] w-[380px] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot size={18} className="text-slate-700" />
              <span className="font-semibold text-slate-800 text-sm">Project Intelligence AI</span>
              {projectId && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{projectId}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {aiStatus === "offline" && (
                <span className="flex items-center gap-1 text-xs text-amber-600"><AlertCircle size={12} />Offline</span>
              )}
              <button onClick={() => setIsOpen(false)} className="rounded p-1 hover:bg-slate-200">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100">
                    <Bot size={14} className="text-slate-600" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user" ? "bg-blue-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md"
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === "assistant" && msg.provider && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                      <span>{msg.provider}</span>
                      {msg.model && <span>· {msg.model}</span>}
                      {msg.status === "error" && <span className="text-red-400">· failed</span>}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
                    <User size={14} className="text-white" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100"><Bot size={14} className="text-slate-600" /></div>
                <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-slate-100 bg-white px-3 py-2">
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={aiStatus === "offline" ? "AI is offline..." : projectId ? `Ask about ${projectId}...` : "Ask about portfolio..."}
                disabled={aiStatus === "offline"}
                rows={1}
                className="max-h-24 flex-1 resize-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading || aiStatus === "offline"}
                className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 text-center">AI-generated responses. Verify before acting.</p>
          </div>
        </div>
      )}
    </>
  );
}
