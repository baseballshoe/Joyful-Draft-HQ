// client/src/components/ask-ai.tsx
// ─────────────────────────────────
// Reusable AI component for JOYT — v2 with:
//  - Fixed "Ask 🤖" button order
//  - Dashboard search bar variant that opens the same sidebar
//  - Same engine, multiple entry points
//
// Usage:
//   Sidebar only (floating button):
//     <AskAI pageContext="roster" />
//
//   With prominent search bar (dashboard top):
//     <AskAI pageContext="dashboard" showSearchBar />

import { useState, useEffect, useRef, useCallback } from 'react';

interface Message {
  role:    'user' | 'assistant';
  content: string;
  id?:     number | string;
}

interface AskAIProps {
  pageContext:    string;
  contextData?:   any;
  showSearchBar?: boolean;  // If true, also renders an inline search bar
}

function getOrCreateSessionId(): string {
  const KEY = 'joyt_ai_session_id';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export default function AskAI({ pageContext, contextData, showSearchBar = false }: AskAIProps) {
  const [open, setOpen]               = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sessionId]                   = useState(() => getOrCreateSessionId());
  const messagesEndRef                = useRef<HTMLDivElement>(null);
  const inputRef                      = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/ai/suggestions?pageContext=${pageContext}`)
      .then(r => r.json())
      .then(d => setSuggestions(d.prompts ?? []))
      .catch(() => {});
  }, [pageContext]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

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

  const sendMessage = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? input).trim();
    if (!question || isStreaming) return;

    setInput('');
    setIsStreaming(true);

    setMessages(prev => [...prev, { role: 'user', content: question }]);
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
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.type === 'text') {
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + chunk.content };
                }
                return next;
              });
            } else if (chunk.type === 'error') {
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: `⚠️ ${chunk.content}` };
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
          next[next.length - 1] = { ...last, content: `⚠️ ${err.message ?? 'Something went wrong'}` };
        }
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, sessionId, pageContext, contextData]);

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

  // Search bar submit — opens sidebar and sends the question
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) {
      setOpen(true);
      return;
    }
    setSearchInput('');
    setOpen(true);
    sendMessage(q);
  };

  return (
    <>
      {/* Inline search bar — shows when showSearchBar=true */}
      {showSearchBar && (
        <div style={{
          background: 'linear-gradient(135deg, var(--joyt-pink-light), var(--joyt-indigo-light))',
          borderRadius: 12,
          padding: '14px 18px',
          margin: '8px 12px',
          border: '1px solid var(--joyt-border)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--joyt-text)' }}>
              Ask anything about your team
            </span>
            <span style={{
              fontSize: 10,
              color: 'var(--joyt-text-light)',
              background: 'var(--joyt-card)',
              padding: '2px 7px',
              borderRadius: 4,
              border: '1px solid var(--joyt-border)',
              marginLeft: 'auto',
            }}>
              Ctrl+K
            </span>
          </div>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Who should I draft? Should I drop someone? What's my weakness?"
              style={{
                flex: 1,
                background: 'var(--joyt-card)',
                border: '1px solid var(--joyt-border)',
                borderRadius: 8,
                padding: '9px 13px',
                fontSize: 13,
                color: 'var(--joyt-text)',
                fontFamily: 'inherit',
                outline: 'none',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--joyt-pink)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--joyt-border)'}
            />
            <button
              type="submit"
              style={{
                background: 'var(--joyt-pink)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '9px 18px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Ask
            </button>
          </form>
          {suggestions.length > 0 && (
            <div style={{
              display: 'flex',
              gap: 5,
              flexWrap: 'wrap',
              marginTop: 8,
            }}>
              {suggestions.slice(0, 3).map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setOpen(true); sendMessage(s); }}
                  style={{
                    background: 'var(--joyt-card)',
                    border: '1px solid var(--joyt-border)',
                    borderRadius: 16,
                    padding: '4px 10px',
                    fontSize: 11,
                    color: 'var(--joyt-text-mid)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onMouseOver={e => {
                    e.currentTarget.style.background = 'var(--joyt-pink-light)';
                    e.currentTarget.style.borderColor = 'var(--joyt-pink)';
                    e.currentTarget.style.color = 'var(--joyt-pink)';
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.background = 'var(--joyt-card)';
                    e.currentTarget.style.borderColor = 'var(--joyt-border)';
                    e.currentTarget.style.color = 'var(--joyt-text-mid)';
                  }}
                >
                  💡 {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Floating button — bottom right (always present) */}
      <button
        onClick={() => setOpen(true)}
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
        Ask <span style={{ fontSize: 18 }}>🤖</span>
      </button>

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

        {/* Messages */}
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
                What's up — ask me anything
              </div>
              <div style={{ fontSize: 11, color: 'var(--joyt-text-light)', marginBottom: 18 }}>
                I know your roster, your league, and your players' current stats.
              </div>

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
                        transition: 'background .15s',
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
                {m.role === 'user' ? 'You' : '🤖 Coach'}
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

        {/* Input */}
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
              }}
            >
              {isStreaming ? '...' : 'Send'}
            </button>
          </div>
          <div style={{
            fontSize: 9, color: 'var(--joyt-text-light)',
            textAlign: 'center', marginTop: 6,
          }}>
            AI-generated · Press Enter to send · Esc to close · Ctrl+K to toggle
          </div>
        </div>
      </aside>
    </>
  );
}
