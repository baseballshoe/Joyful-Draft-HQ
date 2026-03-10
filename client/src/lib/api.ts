async function request(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  getPlayers: (params?: Record<string, string>) => {
    const qs = params && Object.keys(params).length
      ? '?' + new URLSearchParams(params).toString()
      : '';
    return request('GET', `/api/players${qs}`);
  },
  patchPlayer: (id: number, updates: Record<string, unknown>) =>
    request('PATCH', `/api/players/${id}`, updates),
  resetPlayer: (id: number) =>
    request('POST', `/api/players/${id}/reset`),
  getDashboard: () =>
    request('GET', '/api/dashboard'),
  getDraftState: () =>
    request('GET', '/api/draft-state'),
  patchDraftState: (updates: Record<string, unknown>) =>
    request('PATCH', '/api/draft-state', updates),
  getCheatSheet: () =>
    request('GET', '/api/cheat-sheet'),
  patchCheatSheet: (section: string, value: string) =>
    request('PATCH', `/api/cheat-sheet/${section}`, { content: value }),
  getRoundStrategy: () =>
    request('GET', '/api/round-strategy'),
  patchRoundStrategy: (id: number, updates: Record<string, unknown>) =>
    request('PATCH', `/api/round-strategy/${id}`, updates),
};
