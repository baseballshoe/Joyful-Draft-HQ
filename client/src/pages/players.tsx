import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { PosBadge, TagPill, TagSelector, ActionBtns, StatusPill, EditableRank } from '@/components/game-ui';

const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'];
const STATUSES  = ['all', 'available', 'mine', 'drafted'];
const TAGS      = ['all', 'sleeper', 'target', 'watch', 'injured', 'skip'];

export default function Players() {
  const [players, setPlayers] = useState<any[]>([]);
  const [search,  setSearch]  = useState('');
  const [pos,     setPos]     = useState('All');
  const [status,  setStatus]  = useState('all');
  const [tag,     setTag]     = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (pos    !== 'All') params.pos    = pos;
    if (status !== 'all') params.status = status;
    if (tag    !== 'all') params.tag    = tag;
    if (search)           params.search = search;
    const data = await api.getPlayers(params);
    setPlayers(data);
    setLoading(false);
  }, [pos, status, tag, search]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  function updateLocal(updated: any) {
    setPlayers((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  const statusColors: Record<string, string> = {
    available: 'active-green', mine: 'active-blue', drafted: 'active-red', all: '',
  };
  const tagColors: Record<string, string> = {
    sleeper: 'active-purple', target: 'active-amber', watch: 'active-blue',
    injured: 'active-orange', skip: 'active-red', all: '',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Filter bar */}
      <div style={{
        background: 'var(--joyt-card)', borderBottom: '1px solid var(--joyt-border)',
        padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
      }}>
        {/* Row 1: search + position pills */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="search-input"
            style={{ width: 220 }}
            placeholder="Search name or team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-player-search"
          />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => (
              <button key={p}
                className={`filter-pill ${pos === p ? 'active' : ''}`}
                onClick={() => setPos(p)}
                data-testid={`filter-pos-${p.toLowerCase()}`}>
                {p}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {STATUSES.map((s) => (
              <button key={s}
                className={`filter-pill ${status === s ? (statusColors[s] || 'active') : ''}`}
                onClick={() => setStatus(s)}
                style={{ textTransform: 'capitalize' }}
                data-testid={`filter-status-${s}`}>
                {s === 'all' ? 'All Status' : s === 'mine' ? 'My Picks' : s === 'drafted' ? 'Drafted' : 'Available'}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: tag filters */}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          background: 'var(--joyt-pink-light)', padding: '5px 8px', borderRadius: 6,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--joyt-pink)', marginRight: 4 }}>TAGS</span>
          {TAGS.map((t) => (
            <button key={t}
              className={`filter-pill ${tag === t ? (tagColors[t] || 'active') : ''}`}
              onClick={() => setTag(t)}
              data-testid={`filter-tag-${t}`}>
              {t === 'all' ? 'All Tags' : t}
            </button>
          ))}
        </div>

        {/* Tip */}
        <div style={{ fontSize: 11, color: 'var(--joyt-blue)', background: 'var(--joyt-blue-light)',
                      padding: '4px 10px', borderRadius: 5 }}>
          ✎ Click MY RANK, ROUND ✎, or MY POS ✎ cells to edit inline — press Enter or click away to save
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, color: 'var(--joyt-text-mid)', textAlign: 'center' }}>Loading…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 46 }}>#RNK</th>
                <th style={{ width: 44 }}>CON</th>
                <th style={{ width: 38 }}>FP</th>
                <th style={{ width: 44 }}>ESPN</th>
                <th style={{ minWidth: 160 }}>PLAYER</th>
                <th style={{ width: 48 }}>POS</th>
                <th style={{ width: 52 }}>TEAM</th>
                <th style={{ width: 84 }}>MY RANK</th>
                <th style={{ width: 80 }}>ROUND ✎</th>
                <th style={{ width: 86 }}>MY POS ✎</th>
                <th style={{ minWidth: 120 }}>TAGS</th>
                <th style={{ width: 90 }}>STATUS</th>
                <th style={{ width: 148 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className={`status-${p.status}`} data-testid={`row-player-${p.id}`}>
                  <td>
                    <span className={`rank-num ${p.myRank ? 'custom' : 'consensus'}`}>
                      #{Math.round(p.priorityRank)}
                    </span>
                  </td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>
                    {p.consensusRank ? Math.round(p.consensusRank) : '—'}
                  </td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.fpRank ?? '—'}</td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.espnRank ?? '—'}</td>
                  <td>
                    <span style={{ fontWeight: 700, fontSize: 13 }} data-testid={`text-name-${p.id}`}>{p.name}</span>
                  </td>
                  <td><PosBadge pos={p.posDisplay} /></td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.team}</td>
                  <td>
                    <EditableRank value={p.myRank} playerId={p.id}
                      field="myRank" color="amber" onSave={updateLocal} />
                  </td>
                  <td>
                    <EditableRank value={p.roundOverride} playerId={p.id}
                      field="roundOverride" color="amber" onSave={updateLocal} />
                  </td>
                  <td>
                    <EditableRank value={p.myPosRank} playerId={p.id}
                      field="myPosRank" color="pink" onSave={updateLocal} />
                  </td>
                  <td>
                    <TagSelector tags={p.tagsArray ?? []} playerId={p.id} onSave={updateLocal} />
                  </td>
                  <td><StatusPill status={p.status} /></td>
                  <td>
                    <ActionBtns player={p} onUpdate={updateLocal} />
                  </td>
                </tr>
              ))}
              {players.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ textAlign: 'center', padding: 40, color: 'var(--joyt-text-light)' }}>
                    No players match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{
        padding: '6px 14px', background: 'var(--joyt-card)', borderTop: '1px solid var(--joyt-border)',
        fontSize: 11, color: 'var(--joyt-text-light)',
      }}
      data-testid="text-player-count">
        Showing {players.length} players
      </div>
    </div>
  );
}
