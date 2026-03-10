import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { PosBadge } from '@/components/game-ui';

const POS_LIST = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'];
const POS_FULL: Record<string, string> = {
  C: 'Catcher', '1B': 'First Base', '2B': 'Second Base', '3B': 'Third Base',
  SS: 'Shortstop', OF: 'Outfield', SP: 'Starting P.', RP: 'Relief P.', DH: 'DH / Hitter',
};
const POS_COLOR: Record<string, string> = {
  C: 'var(--joyt-teal)', '1B': 'var(--joyt-green)', '2B': 'var(--joyt-amber)', '3B': 'var(--joyt-pink)',
  SS: 'var(--joyt-red)', OF: 'var(--joyt-orange)', SP: 'var(--joyt-blue)', RP: 'var(--joyt-purple)', DH: 'var(--joyt-text-mid)',
};

export default function ByPosition() {
  const [data, setData] = useState<Record<string, any[]>>({});

  useEffect(() => {
    (async () => {
      const players = await api.getPlayers({ status: 'available' });
      const byPos: Record<string, any[]> = {};
      POS_LIST.forEach((pos) => {
        byPos[pos] = players
          .filter((p: any) => p.posDisplay === pos)
          .sort((a: any, b: any) => {
            const ra = a.myPosRank ?? 9999;
            const rb = b.myPosRank ?? 9999;
            if (ra !== rb) return ra - rb;
            return (a.priorityRank ?? 9999) - (b.priorityRank ?? 9999);
          })
          .slice(0, 5);
      });
      setData(byPos);
    })();
  }, []);

  return (
    <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, height: '100%', overflowY: 'auto' }}>
      {POS_LIST.map((pos) => (
        <div key={pos} className="joyt-card" style={{ overflow: 'hidden' }} data-testid={`card-pos-${pos.toLowerCase()}`}>
          {/* Colored header */}
          <div style={{ background: POS_COLOR[pos], padding: '10px 14px',
                        display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#fff',
                           background: 'rgba(255,255,255,.2)', padding: '2px 8px', borderRadius: 4 }}>
              {pos}
            </span>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{POS_FULL[pos]}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,.7)' }}>
              {(data[pos] ?? []).length} avail
            </span>
          </div>
          {/* Column headers */}
          <div style={{ display: 'flex', padding: '6px 12px',
                        borderBottom: '1px solid var(--joyt-border)',
                        fontSize: 10, fontWeight: 700, color: 'var(--joyt-text-light)' }}>
            <span style={{ width: 20 }}>#</span>
            <span style={{ flex: 1 }}>PLAYER</span>
            <span style={{ width: 44 }}>TEAM</span>
            <span style={{ width: 38 }}>RNK</span>
          </div>
          {/* Rows */}
          {(data[pos] ?? []).map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', padding: '8px 12px',
              borderBottom: '1px solid var(--joyt-border)',
              background: i % 2 === 0 ? '#F9FAFB' : 'var(--joyt-card)',
            }}>
              <span style={{ width: 20, fontWeight: 700, fontSize: 13, color: POS_COLOR[pos] }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ width: 44, color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.team}</span>
              <span style={{ width: 38, fontWeight: 700, fontSize: 14, color: 'var(--joyt-amber)', textAlign: 'right' }}>
                #{Math.round(p.priorityRank)}
              </span>
            </div>
          ))}
          {(data[pos] ?? []).length === 0 && (
            <div style={{ padding: 16, color: 'var(--joyt-text-light)', fontSize: 12 }}>No available players</div>
          )}
        </div>
      ))}
    </div>
  );
}
