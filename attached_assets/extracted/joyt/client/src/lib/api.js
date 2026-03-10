// ── API helpers ───────────────────────────────────────────────────────────
const BASE = '/api';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  // Players
  getPlayers:  (params = {}) => apiFetch('/players?' + new URLSearchParams(params)),
  getPlayer:   (id)          => apiFetch(`/players/${id}`),
  patchPlayer: (id, body)    => apiFetch(`/players/${id}`, { method:'PATCH', body: JSON.stringify(body) }),
  resetPlayer: (id)          => apiFetch(`/players/${id}/reset`, { method:'POST' }),

  // Dashboard
  getDashboard: () => apiFetch('/dashboard'),

  // Draft state
  getDraftState:   ()     => apiFetch('/draft-state'),
  patchDraftState: (body) => apiFetch('/draft-state', { method:'PATCH', body: JSON.stringify(body) }),

  // Round strategy
  getRoundStrategy:   ()        => apiFetch('/round-strategy'),
  patchRoundStrategy: (id,body) => apiFetch(`/round-strategy/${id}`, { method:'PATCH', body: JSON.stringify(body) }),

  // Cheat sheet
  getCheatSheet:   ()              => apiFetch('/cheat-sheet'),
  patchCheatSheet: (section, content) =>
    apiFetch(`/cheat-sheet/${section}`, { method:'PATCH', body: JSON.stringify({ content }) }),
};

// ── WebSocket hook ────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';

export function useWS(onMessage) {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}`;
    let ws, reconnectTimer;

    function connect() {
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        try { cbRef.current(JSON.parse(e.data)); } catch {}
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}
