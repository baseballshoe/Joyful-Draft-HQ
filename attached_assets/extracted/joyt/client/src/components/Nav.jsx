import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { path:'/',               label:'Dashboard'     },
  { path:'/players',        label:'All Players'   },
  { path:'/by-position',    label:'By Position'   },
  { path:'/my-roster',      label:'My Roster'     },
  { path:'/cheat-sheet',    label:'Cheat Sheet'   },
  { path:'/round-strategy', label:'Round Strategy'},
];

export default function Nav({ wsConnected, draftState, onRankModeChange }) {
  const { pathname } = useLocation();

  return (
    <header style={{
      position:'sticky', top:0, zIndex:100,
      background:'var(--header)',
      borderBottom:'1px solid var(--header-sep)',
      height:'var(--nav-h)',
      display:'flex', alignItems:'center',
      padding:'0 16px', gap:0,
    }}>
      {/* Logo */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginRight:24, flexShrink:0 }}>
        <span style={{ fontSize:28, lineHeight:1 }}>💧</span>
        <span style={{
          fontStyle:'italic', fontWeight:700, fontSize:15,
          color:'var(--pink)', letterSpacing:'.02em',
        }}>
          JAZZ ON YOUR TATIS
        </span>
      </div>

      {/* Nav tabs */}
      <nav style={{ display:'flex', gap:4, flex:1 }}>
        {TABS.map(({ path, label }) => {
          const active = pathname === path;
          return (
            <Link key={path} to={path} style={{ textDecoration:'none' }}>
              <span style={{
                display:'block', padding:'6px 14px',
                borderRadius:8,
                background: active ? 'var(--pink)' : 'transparent',
                color: active ? '#fff' : '#8B909A',
                fontSize:12, fontWeight: active ? 700 : 400,
                transition:'all .15s',
                whiteSpace:'nowrap',
              }}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Right side */}
      <div style={{ display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        {/* Rank mode selector */}
        {draftState && (
          <select
            value={draftState.rank_mode}
            onChange={e => onRankModeChange(e.target.value)}
            style={{ fontSize:11 }}
            title="Rank mode for all recommendations"
          >
            <option value="priority">Priority Rank</option>
            <option value="consensus">Consensus Rank</option>
          </select>
        )}
        {/* Live sync indicator */}
        <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12,
                       color: wsConnected ? 'var(--green)' : 'var(--text-mid)' }}>
          <span style={{
            width:8, height:8, borderRadius:'50%',
            background: wsConnected ? 'var(--green)' : '#555',
            boxShadow: wsConnected ? '0 0 6px var(--green)' : 'none',
          }} />
          {wsConnected ? 'Live Sync' : 'Connecting…'}
        </span>
      </div>
    </header>
  );
}
