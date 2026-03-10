import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { PosBadge, TagPill, TagSelector, ActionBtns, StatusPill, EditableRank } from '../components/UI.jsx';

const POSITIONS = ['All','C','1B','2B','3B','SS','OF','SP','RP','DH'];
const STATUSES  = ['all','available','mine','drafted'];
const TAGS      = ['all','sleeper','target','watch','injured','skip'];

export default function AllPlayers() {
  const [players, setPlayers]     = useState([]);
  const [search,  setSearch]      = useState('');
  const [pos,     setPos]         = useState('All');
  const [status,  setStatus]      = useState('all');
  const [tag,     setTag]         = useState('all');
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
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

  function updateLocal(updated) {
    setPlayers(prev => prev.map(p => p.id === updated.id ? updated : p));
  }

  const statusColors = {
    available: 'active-green', mine: 'active-blue', drafted: 'active-red', all: ''
  };
  const tagColors = {
    sleeper:'active-purple', target:'active-amber', watch:'active-blue',
    injured:'active-orange', skip:'active-red', all:''
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* Filter bar */}
      <div style={{
        background:'var(--card)', borderBottom:'1px solid var(--border)',
        padding:'8px 14px', display:'flex', flexDirection:'column', gap:6, flexShrink:0,
      }}>
        {/* Row 1: search + position pills */}
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input
            className="search-input"
            style={{ width:220 }}
            placeholder="Search name or team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {POSITIONS.map(p => (
              <button key={p} className={`filter-pill ${pos===p ? 'active' : ''}`}
                onClick={() => setPos(p)}>{p}</button>
            ))}
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
            {STATUSES.map(s => (
              <button key={s} className={`filter-pill ${status===s ? (statusColors[s]||'active') : ''}`}
                onClick={() => setStatus(s)}
                style={{ textTransform:'capitalize' }}>
                {s === 'all' ? 'All Status' : s === 'mine' ? 'My Picks' : s === 'drafted' ? 'Drafted' : 'Available'}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: tag filters */}
        <div style={{
          display:'flex', gap:6, alignItems:'center',
          background:'var(--pink-light)', padding:'5px 8px', borderRadius:6,
        }}>
          <span style={{ fontSize:10, fontWeight:700, color:'var(--pink)', marginRight:4 }}>TAGS</span>
          {TAGS.map(t => (
            <button key={t} className={`filter-pill ${tag===t ? (tagColors[t]||'active') : ''}`}
              onClick={() => setTag(t)}>{t === 'all' ? 'All Tags' : t}</button>
          ))}
        </div>

        {/* Tip */}
        <div style={{ fontSize:11, color:'var(--blue)', background:'var(--blue-light)',
                      padding:'4px 10px', borderRadius:5 }}>
          ✎ Click MY RANK, ROUND ✎, or MY POS ✎ cells to edit inline — press Enter or click away to save
        </div>
      </div>

      {/* Table */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {loading ? (
          <div style={{ padding:40, color:'var(--text-mid)', textAlign:'center' }}>Loading…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{width:46}}>#RNK</th>
                <th style={{width:44}}>CON</th>
                <th style={{width:38}}>FP</th>
                <th style={{width:44}}>ESPN</th>
                <th style={{minWidth:160}}>PLAYER</th>
                <th style={{width:48}}>POS</th>
                <th style={{width:52}}>TEAM</th>
                <th style={{width:84}}>MY RANK</th>
                <th style={{width:80}}>ROUND ✎</th>
                <th style={{width:86}}>MY POS ✎</th>
                <th style={{minWidth:120}}>TAGS</th>
                <th style={{width:90}}>STATUS</th>
                <th style={{width:148}}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {players.map(p => (
                <tr key={p.id} className={`status-${p.status}`}>
                  {/* Priority rank */}
                  <td>
                    <span className={`rank-num ${p.my_rank ? 'custom' : 'consensus'}`}>
                      #{Math.round(p.priority_rank)}
                    </span>
                  </td>
                  {/* Consensus */}
                  <td style={{ color:'var(--text-mid)', fontSize:12 }}>
                    {p.consensus_rank ? Math.round(p.consensus_rank) : '—'}
                  </td>
                  {/* FP */}
                  <td style={{ color:'var(--text-mid)', fontSize:12 }}>{p.fp_rank ?? '—'}</td>
                  {/* ESPN */}
                  <td style={{ color:'var(--text-mid)', fontSize:12 }}>{p.espn_rank ?? '—'}</td>
                  {/* Player name */}
                  <td>
                    <span style={{ fontWeight:700, fontSize:13 }}>{p.name}</span>
                  </td>
                  {/* Position */}
                  <td><PosBadge pos={p.pos_display} /></td>
                  {/* Team */}
                  <td style={{ color:'var(--text-mid)', fontSize:12 }}>{p.team}</td>
                  {/* My Rank — editable amber */}
                  <td>
                    <EditableRank value={p.my_rank} playerId={p.id}
                      field="my_rank" color="amber" onSave={updateLocal} />
                  </td>
                  {/* Round override — editable */}
                  <td>
                    <EditableRank value={p.round_override} playerId={p.id}
                      field="round_override" color="amber" onSave={updateLocal} />
                  </td>
                  {/* My Pos Rank — editable pink */}
                  <td>
                    <EditableRank value={p.my_pos_rank} playerId={p.id}
                      field="my_pos_rank" color="pink" onSave={updateLocal} />
                  </td>
                  {/* Tags */}
                  <td>
                    <TagSelector tags={p.tags} playerId={p.id} onSave={updateLocal} />
                  </td>
                  {/* Status */}
                  <td><StatusPill status={p.status} /></td>
                  {/* Actions */}
                  <td>
                    <ActionBtns player={p} onUpdate={updateLocal} />
                  </td>
                </tr>
              ))}
              {players.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ textAlign:'center', padding:40, color:'var(--text-light)' }}>
                    No players match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{
        padding:'6px 14px', background:'var(--card)', borderTop:'1px solid var(--border)',
        fontSize:11, color:'var(--text-light)',
      }}>
        Showing {players.length} players
      </div>
    </div>
  );
}
