// client/src/components/ask-ai.tsx
// ─────────────────────────────────
// Reusable AI sidebar component for JOYT.
//
// Drop this anywhere in the app:
//   <AskAI pageContext="dashboard" />
//
// Renders:
//  - A floating button (bottom right) that opens the AI sidebar
//  - The sidebar itself (slides in from right when open)
//  - Streaming response handling
//  - Suggested prompts when the conversation is empty
//  - "New Chat" button to clear the session
//
// The sidebar persists across page navigation as long as the component
// is mounted at the layout level. Conversation is per-session.

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────
interface Message {
  role:    'user' | 'assistant';
  content: string;
  id?:     number | string;
}

interface AskAIProps {
  pageContext: string;     // 'dashboard' | 'roster' | 'waiver' | etc
  contextData?: any;       // Optional extra context
}

// Generate a session ID stored in sessionStorage so it persists across
// page navigation but clears when the tab/window closes
function getOrCreateSessionId(): string {
  const KEY = 'joyt_ai_session_id';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export default function AskAI({ pageContext, contextData }: AskAIProps) {
  const [open, setOpen]               = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sessionId]                   = useState(() => getOrCreateSessionId());
  const messagesEndRef                = useRef<HTMLDivElement>(null);
  const inputRef                      = useRef<HTMLTextAreaElement>(null);

  // Load suggestions for current page
  useEffect(() => {
    fetch(`/api/ai/suggestions?pageContext=${pageContext}`)
      .then(r => r.json())
      .then(d => setSuggestions(d.prompts ?? []))
      .catch(() => {});
  }, [pageContext]);

  // Load existing conversation on mount
  useEffect(() => {
    fetch(`/api/ai/history?sessionId=${sessionId}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d) && d.length > 0) {
          setMessages(d.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })));
        }
      })
      .catch(() => {});
  }, [sessionId]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Send a message and stream the response
  const sendMessage = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? input).trim();
    if (!question || isStreaming) return;

    setInput('');
    setIsStreaming(true);

    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    // Add empty assistant message that we'll fill as it streams
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/ai/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId,
          question,
          pageContext,
          contextData,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error('AI request failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE format: "data: {...}\n\n"
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.type === 'text') {
              // Append to last (assistant) message
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    content: last.content + chunk.content,
                  };
                }
                return next;
              });
            } else if (chunk.type === 'error') {
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    content: `⚠️ ${chunk.content}`,
                  };
                }
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            content: `⚠️ ${err.message ?? 'Something went wrong'}`,
          };
        }
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, sessionId, pageContext, contextData]);

  // Clear session and start new chat
  const newChat = useCallback(async () => {
    if (isStreaming) return;
    setMessages([]);
    try {
      await fetch(`/api/ai/session?sessionId=${sessionId}`, { method: 'DELETE' });
    } catch {}
  }, [sessionId, isStreaming]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating button — bottom right */}
      <button
        onClick={() => setOpen(true)}
        className="ask-ai-fab"
        style={{
          position: 'fixed',
          bottom: 18, right: 18, zIndex: 90,
          background: 'var(--joyt-pink)',
          color: '#fff',
          border: 'none',
          borderRadius: '999px',
          padding: '12px 18px',
          fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(247,43,110,0.45)',
          display: open ? 'none' : 'flex',
          alignItems: 'center',
          gap: 7,
          fontFamily: 'inherit',
          transition: 'transform .15s, box-shadow .15s',
        }}
        onMouseOver={e => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(247,43,110,0.55)';
        }}
        onMouseOut={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(247,43,110,0.45)';
        }}
        title="Ask AI (Ctrl+K)"
      >
        <span style={{ fontSize: 18 }}>🤖</span>
        Ask
      </button>

      {/* Backdrop (click to close on mobile) */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.15)',
            zIndex: 99,
            display: 'none',  // Only show on mobile if needed; for desktop keep transparent
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '420px',
          maxWidth: '95vw',
          background: 'var(--joyt-card)',
          borderLeft: '1px solid var(--joyt-border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .25s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--joyt-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ask</div>
            <div style={{ fontSize: 11, color: 'var(--joyt-text-mid)' }}>
              {messages.length === 0 ? 'How can I help?' : `${messages.filter(m => m.role === 'user').length} question${messages.filter(m => m.role === 'user').length !== 1 ? 's' : ''} this session`}
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={newChat}
              disabled={isStreaming}
              style={{
                background: 'var(--joyt-surface)',
                border: '1px solid var(--joyt-border)',
                borderRadius: 6,
                padding: '5px 10px',
                fontSize: 11, fontWeight: 700,
                cursor: isStreaming ? 'not-allowed' : 'pointer',
                color: 'var(--joyt-text-mid)',
                opacity: isStreaming ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
              title="Start a new chat"
            >
              New chat
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              color: 'var(--joyt-text-light)',
              padding: '0 4px',
              lineHeight: 1,
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Messages area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--joyt-text-mid)' }}>
              <div style={{ fontSize: 38, marginBottom: 10 }}>🤖</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--joyt-text)', marginBottom: 5 }}>
                Ask me anything about your team
              </div>
              <div style={{ fontSize: 11, color: 'var(--joyt-text-light)', marginBottom: 18 }}>
                I know your roster, your league, and your players' stats.
              </div>

              {/* Suggested prompts */}
              {suggestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: 'var(--joyt-text-light)',
                    textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4,
                  }}>
                    Try asking
                  </div>
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      style={{
                        background: 'var(--joyt-surface)',
                        border: '1px solid var(--joyt-border)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'var(--joyt-text)',
                        fontFamily: 'inherit',
                        transition: 'background .15s, border-color .15s',
                      }}
                      onMouseOver={e => {
                        e.currentTarget.style.background = 'var(--joyt-pink-light)';
                        e.currentTarget.style.borderColor = 'var(--joyt-pink)';
                      }}
                      onMouseOut={e => {
                        e.currentTarget.style.background = 'var(--joyt-surface)';
                        e.currentTarget.style.borderColor = 'var(--joyt-border)';
                      }}
                    >
                      💡 {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={m.id ?? i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                fontSize: 9, fontWeight: 700, color: 'var(--joyt-text-light)',
                textTransform: 'uppercase', letterSpacing: '.08em',
                marginBottom: 3,
              }}>
                {m.role === 'user' ? 'You' : '🤖 Ask'}
              </div>
              <div style={{
                background: m.role === 'user' ? 'var(--joyt-pink)' : 'var(--joyt-surface)',
                color:      m.role === 'user' ? '#fff' : 'var(--joyt-text)',
                padding: '10px 13px',
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                maxWidth: '92%',
                wordBreak: 'break-word',
              }}>
                {m.content || (m.role === 'assistant' && isStreaming && i === messages.length - 1
                  ? <span style={{ opacity: .5 }}>thinking…</span>
                  : ''
                )}
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{
          borderTop: '1px solid var(--joyt-border)',
          padding: '12px',
          flexShrink: 0,
        }}>
          <div style={{
            background: 'var(--joyt-surface)',
            border: '1px solid var(--joyt-border)',
            borderRadius: 10,
            padding: 8,
            display: 'flex',
            gap: 6,
            alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={isStreaming}
              placeholder="Ask anything about your team..."
              rows={2}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                fontSize: 13,
                color: 'var(--joyt-text)',
                padding: '4px 6px',
                lineHeight: 1.4,
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isStreaming}
              style={{
                background: input.trim() && !isStreaming ? 'var(--joyt-pink)' : 'var(--joyt-border)',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                padding: '7px 12px',
                fontSize: 12, fontWeight: 700,
                cursor: input.trim() && !isStreaming ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                flexShrink: 0,
                transition: 'background .15s',
              }}
            >
              {isStreaming ? '...' : 'Send'}
            </button>
          </div>
          <div style={{
            fontSize: 9, color: 'var(--joyt-text-light)',
            textAlign: 'center', marginTop: 6,
          }}>
            AI-generated responses · Press Enter to send · Esc to close · Ctrl+K to toggle
          </div>
        </div>
      </aside>
    </>
  );
}
