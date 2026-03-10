// ── By Position ───────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { PosBadge, Card } from '../components/UI.jsx';

const POS_LIST = ['C','1B','2B','3B','SS','OF','SP','RP','DH'];
const POS_FULL = {
  C:'Catcher', '1B':'First Base', '2B':'Second Base', '3B':'Third Base',
  SS:'Shortstop', OF:'Outfield', SP:'Starting P.', RP:'Relief P.', DH:'DH / Hitter',
};
const POS_COLOR = {
  C:'var(--teal)', '1B':'var(--green)', '2B':'var(--amber)', '3B':'var(--pink)',
  SS:'var(--red)', OF:'var(--orange)', SP:'var(--blue)', RP:'var(--purple)', DH:'var(--text-mid)',
};

export function ByPosition() {
  const [data, setData] = useState({});

  useEffect(() => {
    (async () => {
      const players = await api.getPlayers({ status:'available' });
      const byPos = {};
      POS_LIST.forEach(pos => {
        byPos[pos] = players
          .filter(p => p.pos_display === pos)
          .sort((a,b) => {
            const ra = a.my_pos_rank ?? 9999;
            const rb = b.my_pos_rank ?? 9999;
            if (ra !== rb) return ra - rb;
            return (a.priority_rank ?? 9999) - (b.priority_rank ?? 9999);
          })
          .slice(0, 5);
      });
      setData(byPos);
    })();
  }, []);

  return (
    <div style={{ padding:10, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, height:'100%', overflowY:'auto' }}>
      {POS_LIST.map(pos => (
        <div key={pos} className="card" style={{ overflow:'hidden' }}>
          {/* Colored header */}
          <div style={{ background: POS_COLOR[pos], padding:'10px 14px',
                        display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontWeight:700, fontSize:13, color:'#fff',
                           background:'rgba(255,255,255,.2)', padding:'2px 8px', borderRadius:4 }}>
              {pos}
            </span>
            <span style={{ fontWeight:700, fontSize:13, color:'#fff' }}>{POS_FULL[pos]}</span>
            <span style={{ marginLeft:'auto', fontSize:10, color:'rgba(255,255,255,.7)' }}>
              {(data[pos]??[]).length} avail
            </span>
          </div>
          {/* Column headers */}
          <div style={{ display:'flex', padding:'6px 12px',
                        borderBottom:'1px solid var(--border)',
                        fontSize:10, fontWeight:700, color:'var(--text-light)' }}>
            <span style={{ width:20 }}>#</span>
            <span style={{ flex:1 }}>PLAYER</span>
            <span style={{ width:44 }}>TEAM</span>
            <span style={{ width:38 }}>RNK</span>
          </div>
          {/* Rows */}
          {(data[pos] ?? []).map((p, i) => (
            <div key={p.id} style={{
              display:'flex', alignItems:'center', padding:'8px 12px',
              borderBottom:'1px solid var(--border)',
              background: i%2===0 ? '#F9FAFB' : 'var(--card)',
            }}>
              <span style={{ width:20, fontWeight:700, fontSize:13, color: POS_COLOR[pos] }}>{i+1}</span>
              <span style={{ flex:1, fontWeight:700, fontSize:13, overflow:'hidden',
                             textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</span>
              <span style={{ width:44, color:'var(--text-mid)', fontSize:12 }}>{p.team}</span>
              <span style={{ width:38, fontWeight:700, fontSize:14, color:'var(--amber)', textAlign:'right' }}>
                #{Math.round(p.priority_rank)}
              </span>
            </div>
          ))}
          {(data[pos]??[]).length === 0 && (
            <div style={{ padding:16, color:'var(--text-light)', fontSize:12 }}>No available players</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── My Roster ─────────────────────────────────────────────────────────────
const ROSTER_SLOTS = [
  {pos:'C',total:1},{pos:'1B',total:1},{pos:'2B',total:1},{pos:'3B',total:1},
  {pos:'SS',total:1},{pos:'OF',total:4},{pos:'Util',total:1},{pos:'SP',total:4},
  {pos:'RP',total:2},{pos:'P',total:3},{pos:'BN',total:5},
];
const SLOT_COLOR = {
  C:'var(--teal)', '1B':'var(--green)', '2B':'var(--amber)', '3B':'var(--pink)',
  SS:'var(--red)', OF:'var(--orange)', Util:'var(--text-mid)',
  SP:'var(--blue)', RP:'var(--purple)', P:'var(--blue)', BN:'var(--text-light)',
};
const H2H_CATS = ['AVG','HR','SB','RBI','R','QS','SAVE','ERA','WHIP','K'];

export function MyRoster() {
  const [myPicks, setMyPicks] = useState([]);

  useEffect(() => {
    api.getPlayers({ status:'mine' }).then(setMyPicks);
  }, []);

  const counts = {};
  myPicks.forEach(p => { counts[p.pos_display] = (counts[p.pos_display]??0)+1; });

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {/* Position tiles */}
      <div style={{
        display:'flex', gap:6, padding:'8px 10px',
        background:'var(--card)', borderBottom:'1px solid var(--border)',
        flexShrink:0, flexWrap:'wrap',
      }}>
        {ROSTER_SLOTS.map(({pos,total}) => {
          const filled = counts[pos] ?? 0;
          const pct    = Math.min(filled/total, 1);
          const color  = SLOT_COLOR[pos] ?? 'var(--text-mid)';
          const col    = pct>=1 ? 'var(--green)' : pct>0 ? 'var(--amber)' : 'var(--border)';
          return (
            <div key={pos} className="card" style={{
              flex:'1 1 100px', minWidth:90, maxWidth:140, padding:'8px 10px',
              borderTop:`3px solid ${col}`,
            }}>
              <div style={{ fontWeight:700, fontSize:14, color }}>{pos}</div>
              <div className="progress-bar" style={{ margin:'6px 0' }}>
                <div className="fill" style={{ width:`${pct*100}%`, background:col }} />
              </div>
              <div style={{ fontWeight:700, fontSize:12, color:col }}>{filled}/{total}</div>
            </div>
          );
        })}
      </div>

      {/* Draft picks table */}
      <div style={{ flex:1, overflowY:'auto', padding:'10px' }}>
        <div className="card" style={{ overflow:'hidden' }}>
          <div className="card-header">
            <span className="dot" style={{ background:'var(--green)' }} />
            <h3>My Draft Picks</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{width:60}}>PICK #</th>
                <th style={{minWidth:160}}>PLAYER</th>
                <th style={{width:56}}>POS</th>
                <th style={{width:56}}>TEAM</th>
                <th style={{width:86}}>CONSENSUS</th>
                <th style={{width:76}}>FP RANK</th>
                <th style={{width:90}}>ROUND TIER</th>
                <th style={{width:100}}>PRIORITY</th>
                <th>NOTES</th>
              </tr>
            </thead>
            <tbody>
              {myPicks.map((p, i) => (
                <tr key={p.id}>
                  <td>
                    <span style={{
                      width:32, height:32, borderRadius:'50%',
                      background:'var(--amber)', color:'#fff',
                      display:'inline-flex', alignItems:'center', justifyContent:'center',
                      fontWeight:700, fontSize:13,
                    }}>{i+1}</span>
                  </td>
                  <td><span style={{ fontWeight:700, fontSize:14 }}>{p.name}</span></td>
                  <td><PosBadge pos={p.pos_display} /></td>
                  <td style={{ color:'var(--text-mid)' }}>{p.team}</td>
                  <td style={{ color:'var(--text-mid)' }}>#{p.consensus_rank ? Math.round(p.consensus_rank) : '—'}</td>
                  <td style={{ color:'var(--text-mid)' }}>#{p.fp_rank ?? '—'}</td>
                  <td style={{ color:'var(--text-mid)' }}>Rd {Math.ceil((p.consensus_rank??1)/12)}</td>
                  <td style={{ fontWeight:700, color:'var(--amber)' }}>
                    #{Math.round(p.priority_rank)}
                  </td>
                  <td style={{ color:'var(--text-mid)', fontSize:12 }}>{p.notes || '—'}</td>
                </tr>
              ))}
              {myPicks.length === 0 && (
                <tr><td colSpan={9} style={{ padding:40, textAlign:'center', color:'var(--text-light)' }}>
                  Mark players as "Mine" to track your draft picks
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* H2H categories footer */}
      <div style={{
        background:'var(--header)', padding:'12px 16px',
        display:'flex', gap:16, alignItems:'center', flexShrink:0,
      }}>
        <span style={{ fontSize:11, fontWeight:700, color:'#5C6370' }}>H2H CATEGORIES:</span>
        {H2H_CATS.map(c => (
          <span key={c} style={{ fontWeight:700, fontSize:12, color:'var(--green)' }}>{c}</span>
        ))}
      </div>
    </div>
  );
}

// ── Cheat Sheet ───────────────────────────────────────────────────────────
export function CheatSheet() {
  const [content, setContent] = useState({ strategy:'', avoid:'', sleepers:'', scratchpad:'' });

  useEffect(() => {
    api.getCheatSheet().then(setContent);
  }, []);

  async function save(section, value) {
    setContent(c => ({ ...c, [section]: value }));
    await api.patchCheatSheet(section, value);
  }

  const sections = [
    { key:'strategy', title:'Draft Strategy',  accent:'var(--blue)',   placeholder:'Add your draft strategy notes…' },
    { key:'avoid',    title:'Avoid / Red Flags',accent:'var(--red)',    placeholder:'Players to avoid, injury concerns…' },
    { key:'sleepers', title:'Sleeper Targets',  accent:'var(--purple)', placeholder:'Late-round value plays…' },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{
        background:'var(--pink-light)', padding:'8px 16px',
        fontSize:12, color:'var(--pink)', fontWeight:500, flexShrink:0,
      }}>
        Your draft notes — type in any section. Changes auto-save and sync to your partner in real time.
      </div>

      <div style={{ flex:1, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, padding:10, overflow:'hidden' }}>
        {sections.map(({ key, title, accent, placeholder }) => (
          <Card key={key} accent={accent} title={title} style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <textarea
              className="notes-area"
              style={{ flex:1, margin:10, height:'calc(100% - 20px)', resize:'none' }}
              placeholder={placeholder}
              value={content[key] ?? ''}
              onChange={e => save(key, e.target.value)}
            />
          </Card>
        ))}
      </div>

      {/* Scratch pad */}
      <div style={{
        background:'var(--header)', padding:'10px 16px',
        display:'flex', gap:12, alignItems:'flex-start', flexShrink:0,
      }}>
        <span style={{ fontSize:11, fontWeight:700, color:'#5C6370', whiteSpace:'nowrap', paddingTop:3 }}>
          SCRATCH PAD:
        </span>
        <textarea
          style={{
            flex:1, background:'transparent', border:'none', outline:'none',
            color:'#9AA3AF', fontSize:12, fontFamily:'var(--font)', resize:'none', height:36,
          }}
          placeholder="Live draft notes — anything goes…"
          value={content.scratchpad ?? ''}
          onChange={e => save('scratchpad', e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Round Strategy ────────────────────────────────────────────────────────
const ALL_POSITIONS = ['C','1B','2B','3B','SS','OF','SP','RP','DH','P','BN','Util'];
const TIERS = [
  'ELITE TIER','TIER 1','TIER 1-2','TIER 2','TIER 2-3','TIER 3',
  'TIER 3-4','TIER 4','SLEEPER RD','DEPTH','LOTTERY PICKS',
];
const TIER_COLORS = {
  'ELITE TIER':   { color:'var(--orange)', bg:'var(--orange-light)' },
  'TIER 1':       { color:'var(--blue)',   bg:'var(--blue-light)'   },
  'TIER 1-2':     { color:'var(--teal)',   bg:'var(--teal-light)'   },
  'TIER 2':       { color:'var(--green)',  bg:'var(--green-light)'  },
  'TIER 2-3':     { color:'var(--green)',  bg:'var(--green-light)'  },
  'TIER 3':       { color:'var(--text-mid)', bg:'var(--surface)'    },
  'TIER 3-4':     { color:'var(--text-mid)', bg:'var(--surface)'    },
  'TIER 4':       { color:'var(--text-light)', bg:'var(--surface)'  },
  'SLEEPER RD':   { color:'var(--purple)', bg:'var(--purple-light)' },
  'DEPTH':        { color:'var(--text-light)', bg:'var(--surface)'  },
  'LOTTERY PICKS':{ color:'var(--pink)',   bg:'var(--pink-light)'   },
};

export function RoundStrategy() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.getRoundStrategy().then(r => {
      setRows(r.map(row => ({
        ...row,
        target_positions: row.target_positions ? row.target_positions.split(',').filter(Boolean) : [],
      })));
    });
  }, []);

  async function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    await api.patchRoundStrategy(id, { [field]: Array.isArray(value) ? value.join(',') : value });
  }

  function togglePos(row, pos) {
    const cur = row.target_positions;
    const next = cur.includes(pos) ? cur.filter(p => p !== pos) : [...cur, pos];
    updateRow(row.id, 'target_positions', next);
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{
        background:'var(--blue-light)', padding:'8px 16px',
        fontSize:12, color:'var(--blue)', flexShrink:0,
      }}>
        Round-by-round plan — click target positions to toggle, select tier from dropdown. Changes sync instantly.
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:10 }}>
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{width:42}}>RD</th>
                <th style={{width:80}}>PICKS</th>
                <th style={{width:240}}>TARGET POSITION</th>
                <th style={{width:180}}>TIER / APPROACH</th>
                <th style={{minWidth:200}}>TARGET NAMES</th>
                <th>NOTES / STRATEGY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const tc = TIER_COLORS[row.tier] ?? TIER_COLORS['DEPTH'];
                return (
                  <tr key={row.id} style={{ background: i%2===0 ? '#FAFBFF' : 'var(--card)' }}>
                    <td><span style={{ fontWeight:700, fontSize:16 }}>{row.round_num}</span></td>
                    <td style={{ color:'var(--text-light)', fontSize:12 }}>{row.picks_range}</td>
                    <td>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                        {ALL_POSITIONS.map(pos => {
                          const active = row.target_positions.includes(pos);
                          const pc = { C:'var(--teal)', '1B':'var(--green)', '2B':'var(--amber)',
                            '3B':'var(--pink)', SS:'var(--red)', OF:'var(--orange)',
                            SP:'var(--blue)', RP:'var(--purple)', DH:'var(--text-mid)',
                            P:'var(--blue)', BN:'var(--text-light)', Util:'var(--text-mid)' }[pos];
                          return (
                            <button key={pos}
                              className="pos-badge"
                              onClick={() => togglePos(row, pos)}
                              style={{
                                color: active ? pc : 'var(--text-light)',
                                background: active ? `${pc}22` : 'var(--surface)',
                                border: active ? `1px solid ${pc}` : '1px solid transparent',
                                cursor:'pointer', fontSize:9, fontWeight:700,
                                padding:'2px 6px',
                              }}>
                              {pos}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <select
                        value={row.tier}
                        onChange={e => updateRow(row.id, 'tier', e.target.value)}
                        style={{ color: tc.color, background: tc.bg,
                                 fontWeight:700, fontSize:11 }}>
                        {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        style={{
                          background:'transparent', border:'none', outline:'none',
                          fontFamily:'var(--font)', fontSize:12, color:'var(--text)',
                          width:'100%', padding:'4px 0',
                        }}
                        value={row.target_names}
                        onChange={e => setRows(prev => prev.map(r => r.id===row.id ? {...r, target_names:e.target.value} : r))}
                        onBlur={e => updateRow(row.id, 'target_names', e.target.value)}
                        placeholder="Names…"
                      />
                    </td>
                    <td>
                      <input
                        style={{
                          background:'transparent', border:'none', outline:'none',
                          fontFamily:'var(--font)', fontSize:12, color:'var(--text-mid)',
                          width:'100%', padding:'4px 0',
                        }}
                        value={row.notes}
                        onChange={e => setRows(prev => prev.map(r => r.id===row.id ? {...r, notes:e.target.value} : r))}
                        onBlur={e => updateRow(row.id, 'notes', e.target.value)}
                        placeholder="Strategy notes…"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{
        background:'var(--pink-light)', padding:'8px 16px',
        fontSize:11, color:'var(--pink)', flexShrink:0,
        borderTop:'1px solid var(--border)',
      }}>
        ✎ Click any position badge to toggle on/off. Select tier from dropdown. Editable name and notes fields — changes save on blur.
      </div>
    </div>
  );
}
