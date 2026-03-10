import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { PosBadge } from '@/components/game-ui';

const ROSTER_SLOTS = [
  { pos: 'C', total: 1 }, { pos: '1B', total: 1 }, { pos: '2B', total: 1 }, { pos: '3B', total: 1 },
  { pos: 'SS', total: 1 }, { pos: 'OF', total: 4 }, { pos: 'Util', total: 1 }, { pos: 'SP', total: 4 },
  { pos: 'RP', total: 2 }, { pos: 'P', total: 3 }, { pos: 'BN', total: 5 },
];
const SLOT_COLOR: Record<string, string> = {
  C: 'var(--joyt-teal)', '1B': 'var(--joyt-green)', '2B': 'var(--joyt-amber)', '3B': 'var(--joyt-pink)',
  SS: 'var(--joyt-red)', OF: 'var(--joyt-orange)', Util: 'var(--joyt-text-mid)',
  SP: 'var(--joyt-blue)', RP: 'var(--joyt-purple)', P: 'var(--joyt-blue)', BN: 'var(--joyt-text-light)',
};
const H2H_CATS = ['AVG', 'HR', 'SB', 'RBI', 'R', 'QS', 'SAVE', 'ERA', 'WHIP', 'K'];

function SlotBadge({ slot }: { slot?: string | null }) {
  if (!slot) return null;
  const color = SLOT_COLOR[slot] ?? 'var(--joyt-text-mid)';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 5,
      background: `${color}22`, color, fontWeight: 700, fontSize: 11, letterSpacing: '.03em',
    }}>{slot}</span>
  );
}

export default function MyRoster() {
  const [myPicks, setMyPicks] = useState<any[]>([]);

  useEffect(() => {
    api.getPlayers({ status: 'mine' }).then(setMyPicks);
  }, []);

  // Count by rosterSlot (fall back to posDisplay for legacy data)
  const counts: Record<string, number> = {};
  myPicks.forEach((p) => {
    const slot = p.rosterSlot ?? p.posDisplay;
    counts[slot] = (counts[slot] ?? 0) + 1;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Position tiles */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px',
        background: 'var(--joyt-card)', borderBottom: '1px solid var(--joyt-border)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {ROSTER_SLOTS.map(({ pos, total }) => {
          const filled = counts[pos] ?? 0;
          const pct    = Math.min(filled / total, 1);
          const col    = pct >= 1 ? 'var(--joyt-green)' : pct > 0 ? 'var(--joyt-amber)' : 'var(--joyt-border)';
          return (
            <div key={pos} className="joyt-card" style={{
              flex: '1 1 100px', minWidth: 90, maxWidth: 140, padding: '8px 10px',
              borderTop: `3px solid ${col}`,
            }}
            data-testid={`card-slot-${pos.toLowerCase()}`}>
              <div style={{ fontWeight: 700, fontSize: 14, color: col }}>{pos}</div>
              <div className="progress-bar" style={{ margin: '6px 0' }}>
                <div className="fill" style={{ width: `${pct * 100}%`, background: col }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 12, color: col }}>{filled}/{total}</div>
            </div>
          );
        })}
      </div>

      {/* Draft picks table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        <div className="joyt-card" style={{ overflow: 'hidden' }}>
          <div className="joyt-card-header">
            <span className="dot" style={{ background: 'var(--joyt-green)' }} />
            <h3>My Draft Picks</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>PICK #</th>
                <th style={{ minWidth: 160 }}>PLAYER</th>
                <th style={{ width: 56 }}>POS</th>
                <th style={{ width: 80 }}>SLOT</th>
                <th style={{ width: 56 }}>TEAM</th>
                <th style={{ width: 86 }}>CONSENSUS</th>
                <th style={{ width: 76 }}>FP RANK</th>
                <th style={{ width: 90 }}>ROUND TIER</th>
                <th style={{ width: 100 }}>PRIORITY</th>
                <th>NOTES</th>
              </tr>
            </thead>
            <tbody>
              {myPicks.map((p, i) => (
                <tr key={p.id} data-testid={`row-mypick-${p.id}`}>
                  <td>
                    <span style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'var(--joyt-amber)', color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13,
                    }}>{i + 1}</span>
                  </td>
                  <td><span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span></td>
                  <td><PosBadge pos={p.posDisplay} /></td>
                  <td><SlotBadge slot={p.rosterSlot} /></td>
                  <td style={{ color: 'var(--joyt-text-mid)' }}>{p.team}</td>
                  <td style={{ color: 'var(--joyt-text-mid)' }}>#{p.consensusRank ? Math.round(p.consensusRank) : '—'}</td>
                  <td style={{ color: 'var(--joyt-text-mid)' }}>#{p.fpRank ?? '—'}</td>
                  <td style={{ color: 'var(--joyt-text-mid)' }}>Rd {Math.ceil((p.consensusRank ?? 1) / 12)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--joyt-amber)' }}>
                    #{Math.round(p.priorityRank)}
                  </td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.notes || '—'}</td>
                </tr>
              ))}
              {myPicks.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--joyt-text-light)' }}>
                    Mark players as "Mine" to track your draft picks — roster slots are assigned automatically
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* H2H categories footer */}
      <div style={{
        background: 'var(--joyt-header)', padding: '12px 16px',
        display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#5C6370' }}>H2H CATEGORIES:</span>
        {H2H_CATS.map((c) => (
          <span key={c} style={{ fontWeight: 700, fontSize: 12, color: 'var(--joyt-green)' }}>{c}</span>
        ))}
      </div>
    </div>
  );
}
