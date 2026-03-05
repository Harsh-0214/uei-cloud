'use client';

import { useState, useRef, useEffect } from 'react';

interface QueryInfo { sql: string; rows: number }

interface Message {
  role: 'user' | 'assistant';
  content: string;
  queries: QueryInfo[];
  error?: string;
  loading?: boolean;
}

interface HistoryEntry { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'How many nodes are reporting?',
  'Show the latest SOC for all nodes',
  'Are there any active faults?',
  'What is the average pack voltage?',
  'Show temp trends in the last hour',
];

function renderMd(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setBusy(true);

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, queries: [] },
      { role: 'assistant', content: '', queries: [], loading: true },
    ]);

    let accumulated = '';
    const queries: QueryInfo[] = [];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: { type: string; [k: string]: unknown };
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'text') {
            accumulated += event.text as string;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], content: accumulated, loading: false };
              return next;
            });
          } else if (event.type === 'query') {
            queries.push({ sql: event.sql as string, rows: event.rows as number });
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], queries: [...queries] };
              return next;
            });
          } else if (event.type === 'query_error') {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], error: event.error as string, loading: false };
              return next;
            });
          } else if (event.type === 'done') {
            const assistantText = (event.assistantText as string) || accumulated;
            setHistory((prev) => [
              ...prev,
              { role: 'user', content: text },
              { role: 'assistant', content: assistantText },
            ]);
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], loading: false };
              return next;
            });
          } else if (event.type === 'error') {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], content: `Error: ${event.text}`, loading: false };
              return next;
            });
          }
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], content: `Connection error: ${String(e)}`, loading: false };
        return next;
      });
    }

    setBusy(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function newChat() {
    setMessages([]);
    setHistory([]);
  }

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-500 hover:bg-cyan-400 shadow-lg flex items-center justify-center transition-colors"
        title="Ask AI"
      >
        {open ? (
          <svg className="w-5 h-5 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[560px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div>
              <p className="text-sm font-semibold text-cyan-400">UEI Data Assistant</p>
              <p className="text-xs text-slate-500">Ask about your telemetry data</p>
            </div>
            <button
              onClick={newChat}
              className="text-xs text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 rounded-lg px-2 py-1 transition-colors"
            >
              New chat
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2 pt-2">
                <p className="text-xs text-slate-500 text-center mb-1">Suggestions</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-700 text-slate-300 hover:text-cyan-300 rounded-xl px-3 py-2 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-cyan-700 text-cyan-50 rounded-br-sm'
                      : 'bg-slate-800 text-slate-200 rounded-bl-sm'
                  }`}
                >
                  {msg.queries.length > 0 && (
                    <div className="flex flex-col gap-1 mb-2">
                      {msg.queries.map((q, qi) => (
                        <div key={qi} className="flex items-start gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 font-mono text-sky-400">
                          <span className="text-cyan-500 flex-shrink-0">▶</span>
                          <span className="break-all">{q.sql.trim()}</span>
                          <span className="text-slate-600 ml-auto pl-1 flex-shrink-0">{q.rows}r</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.error && <p className="text-red-400 mb-1">Error: {msg.error}</p>}
                  {msg.loading ? (
                    <div className="flex items-center gap-1.5 text-slate-500 italic">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                      Thinking…
                    </div>
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }}
                      className="[&_pre]:bg-slate-900 [&_pre]:rounded [&_pre]:p-1.5 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:my-1 [&_code]:bg-slate-900 [&_code]:px-1 [&_code]:rounded [&_li]:ml-3"
                    />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={onSubmit} className="flex gap-2 px-3 py-3 border-t border-slate-800 flex-shrink-0">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything…"
              autoComplete="off"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
