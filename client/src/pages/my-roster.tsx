import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { PosBadge } from '@/components/game-ui';

const ROSTER_SLOTS = [
  { pos: 'C', total: 1 }, { pos: '1B', total: 1 }, { pos: '2B', total: 1 }, { pos: '3B', total: 1 },
  { pos: 'SS', total: 1 }, { pos: 'OF', total: 4 }, { pos: 'Util', total: 1 }, { pos: 'SP', total: 4 },
  { pos: 'RP', total: 2 }, { pos: 'P', total: 3 }, { pos: 'BN', total: 5 }, { pos: 'IL', total: 4 },
];
const SLOT_COLOR: Record<string, string> = {
  C: 'var(--joyt-teal)', '1B': 'var(--joyt-green)', '2B': 'var(--joyt-amber)', '3B': 'var(--joyt-pink)',
  SS: 'var(--joyt-red)', OF: 'var(--joyt-orange)', Util: 'var(--joyt-text-mid)',
  SP: 'var(--joyt-blue)', RP: 'var(--joyt-purple)', P: 'var(--joyt-blue)', BN: 'var(--joyt-text-light)',
  IL: '#e05252',
};
const H2H_CATS = ['AVG', 'HR', 'SB', 'RBI', 'R', 'QS', 'SAVE', 'ERA', 'WHIP', 'K'];

export default function MyRoster() {
  const [myPicks, setMyPicks] = useState<any[]>([]);

  useEffect(() => {
    api.getPlayers({ status: 'mine' }).then(setMyPicks);
  }, []);

  const bySlot: Record<string, any[]> = {};
  myPicks.forEach((p) => {
    const slot = p.rosterSlot ?? p.posDisplay;
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(p);
  });

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

      {/* Grouped by position */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {myPicks.length === 0 ? (
          <div className="joyt-card" style={{ padding: 40, textAlign: 'center', color: 'var(--joyt-text-light)' }}>
            Mark players as "Mine" to track your draft picks — roster slots are assigned automatically
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ROSTER_SLOTS.map(({ pos }) => {
              const players = bySlot[pos] ?? [];
              if (players.length === 0) return null;
              const color = SLOT_COLOR[pos] ?? 'var(--joyt-text-mid)';
              return (
                <div key={pos} className="joyt-card" style={{ overflow: 'hidden' }}>
                  {/* Section header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--joyt-border)',
                    background: `${color}10`,
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 34, height: 34, borderRadius: 8,
                      background: `${color}22`, color, fontWeight: 700, fontSize: 13,
                    }}>{pos}</span>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--joyt-text)' }}>
                      {pos === 'C' ? 'Catcher' : pos === '1B' ? 'First Base' : pos === '2B' ? 'Second Base'
                        : pos === '3B' ? 'Third Base' : pos === 'SS' ? 'Shortstop' : pos === 'OF' ? 'Outfield'
                        : pos === 'Util' ? 'Utility' : pos === 'SP' ? 'Starting Pitcher'
                        : pos === 'RP' ? 'Relief Pitcher' : pos === 'P' ? 'Pitcher'
                        : pos === 'IL' ? 'Injured List' : 'Bench'}
                    </span>
                    <span style={{
                      marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                      color, background: `${color}20`, padding: '2px 10px', borderRadius: 20,
                    }}>
                      {players.length} player{players.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Players in this slot */}
                  {players.map((p: any, i: number) => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px',
                      borderBottom: i < players.length - 1 ? '1px solid var(--joyt-border)' : 'none',
                    }} data-testid={`row-roster-${p.id}`}>

                      {/* Draft order bubble */}
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--joyt-amber)', color: '#fff',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 11,
                      }}>
                        {myPicks.findIndex(x => x.id === p.id) + 1}
                      </span>

                      {/* Position badge */}
                      <PosBadge pos={p.posDisplay} />

                      {/* Name + team */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--joyt-text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--joyt-text-light)', marginTop: 1 }}>
                          {p.team}
                        </div>
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: 18, flexShrink: 0, alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--joyt-text-light)', fontWeight: 600 }}>CONSENSUS</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--joyt-text-mid)' }}>
                            #{p.consensusRank ? Math.round(p.consensusRank) : '—'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--joyt-text-light)', fontWeight: 600 }}>FP RANK</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--joyt-text-mid)' }}>
                            #{p.fpRank ?? '—'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--joyt-text-light)', fontWeight: 600 }}>ROUND</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--joyt-text-mid)' }}>
                            {Math.ceil((p.consensusRank ?? 1) / 12)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--joyt-text-light)', fontWeight: 600 }}>PRIORITY</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--joyt-amber)' }}>
                            #{Math.round(p.priorityRank)}
                          </div>
                        </div>
                        {p.notes && (
                          <div style={{ maxWidth: 160, fontSize: 11, color: 'var(--joyt-text-light)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
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
