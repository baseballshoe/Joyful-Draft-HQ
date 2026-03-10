import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { PosBadge, TagPill, ActionBtns, Card } from '../components/UI.jsx';

// ── Stat chip ─────────────────────────────────────────────────────────────
function StatChip({ label, value, color, bg }) {
  return (
    <div style={{
      background: bg, borderRadius:10, padding:'10px 16px',
      borderLeft:`4px solid ${color}`, minWidth:110,
    }}>
      <div style={{ fontSize:22, fontWeight:700, color, lineHeight:1.1 }}>{value}</div>
      <div style={{ fontSize:10, color:'var(--text-light)', marginTop:4 }}>{label}</div>
    </div>
  );
}

// ── Player row for target/sleeper lists ───────────────────────────────────
function PlayerListRow({ player, rank, accentColor, onUpdate }) {
  return (
    <div style={{
      display:'flex', alignItems:'flex-start', gap:8,
      padding:'8px 12px', borderBottom:'1px solid var(--border)',
    }}>
      <span style={{ fontSize:14, fontWeight:700, color:accentColor, minWidth:20 }}>{rank}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <PosBadge pos={player.pos_display} />
          <span style={{ fontWeight:700, fontSize:13, color:'var(--text)' }}
            title={player.name}>
            {player.name}
          </span>
        </div>
        <div style={{ display:'flex', gap:4, marginTop:4, flexWrap:'wrap' }}>
          {player.tags.map(t => <TagPill key={t} tag={t} />)}
        </div>
      </div>
      <div style={{ textAlign:'right', flexShrink:0 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'var(--amber)' }}>
          #{Math.round(player.priority_rank)}
        </div>
        <div style={{ marginTop:4 }}>
          <ActionBtns player={player} onUpdate={onUpdate} size="sm" />
        </div>
      </div>
    </div>
  );
}

// ── Round chips ───────────────────────────────────────────────────────────
function RoundChip({ player, onUpdate }) {
  return (
    <div style={{
      background:'var(--surface)', borderRadius:8,
      padding:'8px 6px', flex:1, minWidth:0,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <PosBadge pos={player.pos_display} style={{ fontSize:9 }} />
        <span style={{ fontSize:11, fontWeight:700, color:'var(--amber)' }}>
          #{Math.round(player.consensus_rank)}
        </span>
      </div>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--text)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {player.name}
      </div>
      <div style={{ display:'flex', gap:4, marginTop:6 }}>
        <ActionBtns player={player} onUpdate={onUpdate} size="sm" />
      </div>
    </div>
  );
}

// ── Quick Mark ───────────────────────────────────────────────────────────
function QuickMark({ onUpdate }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const data = await api.getPlayers({ search, status:'available' });
      setResults(data.slice(0, 14));
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <input
        className="search-input"
        style={{ margin:'8px 10px', width:'calc(100% - 20px)' }}
        placeholder="Search player…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{ flex:1, overflowY:'auto' }}>
        {results.map(p => (
          <div key={p.id} style={{
            display:'flex', alignItems:'center', gap:6,
            padding:'6px 10px', borderBottom:'1px solid var(--border)',
          }}>
            <PosBadge pos={p.pos_display} style={{ fontSize:9 }} />
            <span style={{ flex:1, fontSize:12, fontWeight:700, minWidth:0,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.name}
            </span>
            <span style={{ fontSize:12, fontWeight:700, color:'var(--amber)', marginRight:4 }}>
              #{Math.round(p.priority_rank)}
            </span>
            <ActionBtns player={p} onUpdate={onUpdate} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── My Roster summary ─────────────────────────────────────────────────────
const ROSTER_SLOTS = [
  { pos:'C',    total:1 }, { pos:'1B', total:1 }, { pos:'2B', total:1 },
  { pos:'3B',   total:1 }, { pos:'SS', total:1 }, { pos:'OF', total:4 },
  { pos:'Util', total:1 }, { pos:'SP', total:4 }, { pos:'RP', total:2 },
  { pos:'P',    total:3 }, { pos:'BN', total:5 },
];

function RosterSummary({ myRoster }) {
  const counts = {};
  myRoster.forEach(p => {
    const pos = p.pos_display;
    counts[pos] = (counts[pos] ?? 0) + 1;
  });

  const POS_COLOR = {
    C:'var(--teal)',   '1B':'var(--green)', '2B':'var(--amber)',
    '3B':'var(--pink)','SS':'var(--red)',   OF:'var(--orange)',
    SP:'var(--blue)',  RP:'var(--purple)',  P:'var(--blue)',
    Util:'var(--text-mid)', BN:'var(--text-light)',
  };

  return (
    <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:4 }}>
      {ROSTER_SLOTS.map(({ pos, total }) => {
        const filled = counts[pos] ?? 0;
        const pct = Math.min(filled / total, 1);
        const color = pct >= 1 ? 'var(--green)' : pct > 0 ? 'var(--amber)' : 'var(--border)';
        return (
          <div key={pos} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:10, fontWeight:700, color:'var(--text)', minWidth:28 }}>{pos}</span>
            <div className="progress-bar" style={{ flex:1 }}>
              <div className="fill" style={{ width:`${pct*100}%`, background:color }} />
            </div>
            <span style={{ fontSize:10, fontWeight:700, color, minWidth:28 }}>{filled}/{total}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Best by Position ──────────────────────────────────────────────────────
const POSITIONS = ['C','1B','2B','3B','SS','OF','SP','RP','DH'];

function BestByPos({ bestByPos, onUpdate }) {
  return (
    <div style={{ padding:'4px 0' }}>
      {POSITIONS.map(pos => {
        const p = bestByPos[pos];
        if (!p) return (
          <div key={pos} style={{ display:'flex', alignItems:'center', gap:8,
            padding:'7px 12px', borderBottom:'1px solid var(--border)',
            color:'var(--text-light)', fontSize:11 }}>
            <PosBadge pos={pos} /><span>—</span>
          </div>
        );
        return (
          <div key={pos} style={{ display:'flex', alignItems:'center', gap:8,
            padding:'7px 12px', borderBottom:'1px solid var(--border)' }}>
            <PosBadge pos={pos} />
            <span style={{ flex:1, fontSize:12, fontWeight:700 }}>{p.name}</span>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--amber)' }}>
              #{Math.round(p.priority_rank)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard({ draftState, onDraftStateChange }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const d = await api.getDashboard();
    setData(d);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Called from WS events or action buttons
  function handlePlayerUpdate(updated) {
    // Trigger a full dashboard refresh (simple and always correct)
    load();
  }

  if (!data) return <div style={{ padding:40, color:'var(--text-mid)' }}>Loading…</div>;

  const round = draftState?.current_round ?? 1;
  const roundNums = [round-1, round, round+1].filter(r => r >= 1);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* Stat strip */}
      <div style={{
        background:'var(--card)', borderBottom:'1px solid var(--border)',
        padding:'10px 16px', display:'flex', gap:8, alignItems:'center',
        flexShrink:0,
      }}>
        <StatChip label="Round"     value={round}              color="var(--indigo)" bg="var(--indigo-light)" />
        <StatChip label="My Picks"  value={data.myRoster.length} color="var(--green)" bg="var(--green-light)"  />
        <StatChip label="Drafted"   value={data.state?.drafted ?? '—'} color="var(--text-mid)" bg="var(--surface)" />

        {/* Next best */}
        {data.nextBest && (
          <div style={{
            background:'#FFFBF0', borderRadius:10, padding:'10px 16px',
            borderLeft:'4px solid var(--amber)', display:'flex', alignItems:'center', gap:12,
          }}>
            <div>
              <div style={{ fontSize:9, fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                Next Best Available
              </div>
              <div style={{ fontSize:18, fontWeight:700, color:'var(--text)', marginTop:2 }}>
                {data.nextBest.name}
              </div>
            </div>
            <PosBadge pos={data.nextBest.pos_display} />
            <span style={{ fontSize:18, fontWeight:700, color:'var(--amber)' }}>
              #{Math.round(data.nextBest.priority_rank)}
            </span>
          </div>
        )}

        <div style={{ flex:1 }} />
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12,
                      background:'var(--green-light)', padding:'6px 14px',
                      borderRadius:20, color:'var(--green)', fontWeight:700 }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--green)',
                         display:'inline-block', boxShadow:'0 0 6px var(--green)' }} />
          Live Sync Active
        </div>
      </div>

      {/* Main grid */}
      <div style={{
        flex:1, overflowY:'auto', padding:8,
        display:'grid',
        gridTemplateColumns:'184px 190px 1fr 172px',
        gridTemplateRows:'auto 1fr',
        gap:8,
      }}>

        {/* Col A Row 1: My Roster */}
        <Card accent="var(--green)" title="My Roster" style={{ gridRow:'1', overflow:'hidden' }}>
          <RosterSummary myRoster={data.myRoster} />
        </Card>

        {/* Col B: Top 10 Targets — spans both rows */}
        <Card accent="var(--pink)" title="Top 10 Targets"
          style={{ gridColumn:2, gridRow:'1 / 3', overflowY:'auto' }}>
          {data.top10Targets.length === 0 && (
            <div style={{ padding:16, color:'var(--text-light)', fontSize:12 }}>
              Tag players as "target" to see them here
            </div>
          )}
          {data.top10Targets.map((p, i) => (
            <PlayerListRow key={p.id} player={p} rank={i+1}
              accentColor="var(--pink)" onUpdate={handlePlayerUpdate} />
          ))}
        </Card>

        {/* Col C Row 1: Current Rounds */}
        <Card accent="var(--blue)" title="Best Available — Current Rounds"
          style={{ gridColumn:3, gridRow:1, overflow:'hidden' }}>
          <div style={{ padding:'8px 10px', display:'flex', flexDirection:'column', gap:8 }}>
            {roundNums.map(r => {
              const players = data.roundData[r] ?? [];
              const pickStart = (r-1)*12+1; const pickEnd = r*12;
              return (
                <div key={r}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{
                      background:'var(--blue-light)', color:'var(--blue)',
                      fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:5,
                    }}>ROUND {r}</span>
                    <span style={{ fontSize:10, color:'var(--text-light)' }}>picks {pickStart}-{pickEnd}</span>
                  </div>
                  <div style={{ display:'flex', gap:4 }}>
                    {players.length === 0
                      ? <span style={{ fontSize:11, color:'var(--text-light)' }}>No players available this round</span>
                      : players.map(p => <RoundChip key={p.id} player={p} onUpdate={handlePlayerUpdate} />)
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Col D: Quick Mark — spans both rows */}
        <Card accent="var(--amber)" title="Quick Mark"
          style={{ gridColumn:4, gridRow:'1 / 3', overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <QuickMark onUpdate={handlePlayerUpdate} />
        </Card>

        {/* Col A Row 2: Best by Position */}
        <Card accent="var(--teal)" title="Best by Position"
          style={{ gridRow:2, overflowY:'auto' }}>
          <BestByPos bestByPos={data.bestByPos} onUpdate={handlePlayerUpdate} />
        </Card>

        {/* Col C Row 2: Sleepers + Top 5 */}
        <div style={{ gridColumn:3, gridRow:2, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <Card accent="var(--purple)" title="Sleepers (tagged)" style={{ overflowY:'auto' }}>
            {data.sleepers.length === 0 && (
              <div style={{ padding:16, color:'var(--text-light)', fontSize:12 }}>
                Tag players as "sleeper" to see them here
              </div>
            )}
            {data.sleepers.map((p, i) => (
              <div key={p.id} style={{
                display:'flex', alignItems:'flex-start', gap:6,
                padding:'7px 10px', borderBottom:'1px solid var(--border)',
              }}>
                <span style={{ fontSize:12, fontWeight:700, color:'var(--purple)', minWidth:18 }}>{i+1}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <PosBadge pos={p.pos_display} style={{ fontSize:9 }} />
                    <span style={{ fontSize:12, fontWeight:700, overflow:'hidden',
                                   textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</span>
                  </div>
                  <div style={{ fontSize:10, color:'var(--text-light)', marginTop:2 }}>
                    Rd {Math.ceil(p.consensus_rank / 12)}
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--amber)' }}>
                    #{Math.round(p.priority_rank)}
                  </div>
                  <div style={{ marginTop:4 }}>
                    <ActionBtns player={p} onUpdate={handlePlayerUpdate} size="sm" />
                  </div>
                </div>
              </div>
            ))}
          </Card>

          <Card accent="var(--amber)" title="Top 5 Available" style={{ overflowY:'auto' }}>
            {data.top5.map((p, i) => (
              <div key={p.id} style={{
                display:'flex', alignItems:'flex-start', gap:8,
                padding:'10px 12px', borderBottom:'1px solid var(--border)',
              }}>
                <span style={{ fontSize:18, fontWeight:700, color:'var(--amber)', minWidth:24 }}>{i+1}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <PosBadge pos={p.pos_display} />
                    <span style={{ fontSize:13, fontWeight:700 }}>{p.name}</span>
                  </div>
                  <div style={{ marginTop:6 }}>
                    <ActionBtns player={p} onUpdate={handlePlayerUpdate} size="sm" />
                  </div>
                </div>
                <span style={{ fontSize:20, fontWeight:700, color:'var(--amber)', flexShrink:0 }}>
                  #{Math.round(p.priority_rank)}
                </span>
              </div>
            ))}
          </Card>
        </div>

      </div>
    </div>
  );
}
