import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const ALL_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH', 'P', 'BN', 'Util'];
const TIERS = [
  'ELITE TIER', 'TIER 1', 'TIER 1-2', 'TIER 2', 'TIER 2-3', 'TIER 3',
  'TIER 3-4', 'TIER 4', 'SLEEPER RD', 'DEPTH', 'LOTTERY PICKS',
];
const TIER_COLORS: Record<string, { color: string; bg: string }> = {
  'ELITE TIER':    { color: 'var(--joyt-orange)', bg: 'var(--joyt-orange-light)' },
  'TIER 1':        { color: 'var(--joyt-blue)',   bg: 'var(--joyt-blue-light)'   },
  'TIER 1-2':      { color: 'var(--joyt-teal)',   bg: 'var(--joyt-teal-light)'   },
  'TIER 2':        { color: 'var(--joyt-green)',  bg: 'var(--joyt-green-light)'  },
  'TIER 2-3':      { color: 'var(--joyt-green)',  bg: 'var(--joyt-green-light)'  },
  'TIER 3':        { color: 'var(--joyt-text-mid)', bg: 'var(--joyt-surface)'    },
  'TIER 3-4':      { color: 'var(--joyt-text-mid)', bg: 'var(--joyt-surface)'    },
  'TIER 4':        { color: 'var(--joyt-text-light)', bg: 'var(--joyt-surface)'  },
  'SLEEPER RD':    { color: 'var(--joyt-purple)', bg: 'var(--joyt-purple-light)' },
  'DEPTH':         { color: 'var(--joyt-text-light)', bg: 'var(--joyt-surface)'  },
  'LOTTERY PICKS': { color: 'var(--joyt-pink)',   bg: 'var(--joyt-pink-light)'   },
};
const POS_COLOR: Record<string, string> = {
  C: 'var(--joyt-teal)', '1B': 'var(--joyt-green)', '2B': 'var(--joyt-amber)', '3B': 'var(--joyt-pink)',
  SS: 'var(--joyt-red)', OF: 'var(--joyt-orange)', SP: 'var(--joyt-blue)', RP: 'var(--joyt-purple)',
  DH: 'var(--joyt-text-mid)', P: 'var(--joyt-blue)', BN: 'var(--joyt-text-light)', Util: 'var(--joyt-text-mid)',
};

type StrategyRow = {
  id: number;
  roundNum: number;
  picksRange: string;
  targetPositions: string[];
  tier: string;
  targetNames: string;
  notes: string;
};

export default function RoundStrategy() {
  const [rows, setRows] = useState<StrategyRow[]>([]);

  useEffect(() => {
    api.getRoundStrategy().then((data: any[]) => {
      setRows(data.map((row) => ({
        ...row,
        targetPositions: row.targetPositions
          ? row.targetPositions.split(',').filter(Boolean)
          : [],
      })));
    });
  }, []);

  async function updateRow(id: number, field: string, value: any) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
    await api.patchRoundStrategy(id, {
      [field]: Array.isArray(value) ? value.join(',') : value,
    });
  }

  function togglePos(row: StrategyRow, pos: string) {
    const cur = row.targetPositions;
    const next = cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos];
    updateRow(row.id, 'targetPositions', next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        background: 'var(--joyt-blue-light)', padding: '8px 16px',
        fontSize: 12, color: 'var(--joyt-blue)', flexShrink: 0,
      }}>
        Round-by-round plan — click target positions to toggle, select tier from dropdown. Changes sync instantly.
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        <div className="joyt-card" style={{ overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 42 }}>RD</th>
                <th style={{ width: 80 }}>PICKS</th>
                <th style={{ width: 240 }}>TARGET POSITION</th>
                <th style={{ width: 180 }}>TIER / APPROACH</th>
                <th style={{ minWidth: 200 }}>TARGET NAMES</th>
                <th>NOTES / STRATEGY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const tc = TIER_COLORS[row.tier] ?? TIER_COLORS['DEPTH'];
                return (
                  <tr key={row.id} style={{ background: i % 2 === 0 ? '#FAFBFF' : 'var(--joyt-card)' }}
                    data-testid={`row-strategy-${row.roundNum}`}>
                    <td><span style={{ fontWeight: 700, fontSize: 16 }}>{row.roundNum}</span></td>
                    <td style={{ color: 'var(--joyt-text-light)', fontSize: 12 }}>{row.picksRange}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {ALL_POSITIONS.map((pos) => {
                          const active = row.targetPositions.includes(pos);
                          const pc = POS_COLOR[pos] ?? 'var(--joyt-text-mid)';
                          return (
                            <button key={pos}
                              className="pos-badge"
                              onClick={() => togglePos(row, pos)}
                              style={{
                                color: active ? pc : 'var(--joyt-text-light)',
                                background: active ? `${pc}22` : 'var(--joyt-surface)',
                                border: active ? `1px solid ${pc}` : '1px solid transparent',
                                cursor: 'pointer', fontSize: 9, fontWeight: 700,
                                padding: '2px 6px',
                              }}
                              data-testid={`toggle-pos-${pos}-${row.roundNum}`}>
                              {pos}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <select
                        value={row.tier}
                        onChange={(e) => updateRow(row.id, 'tier', e.target.value)}
                        style={{ color: tc.color, background: tc.bg, fontWeight: 700, fontSize: 11 }}
                        data-testid={`select-tier-${row.roundNum}`}>
                        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        style={{
                          background: 'transparent', border: 'none', outline: 'none',
                          fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--joyt-text)',
                          width: '100%', padding: '4px 0',
                        }}
                        value={row.targetNames}
                        onChange={(e) => setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, targetNames: e.target.value } : r))}
                        onBlur={(e) => updateRow(row.id, 'targetNames', e.target.value)}
                        placeholder="Names…"
                        data-testid={`input-names-${row.roundNum}`}
                      />
                    </td>
                    <td>
                      <input
                        style={{
                          background: 'transparent', border: 'none', outline: 'none',
                          fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--joyt-text-mid)',
                          width: '100%', padding: '4px 0',
                        }}
                        value={row.notes}
                        onChange={(e) => setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, notes: e.target.value } : r))}
                        onBlur={(e) => updateRow(row.id, 'notes', e.target.value)}
                        placeholder="Strategy notes…"
                        data-testid={`input-notes-${row.roundNum}`}
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
        background: 'var(--joyt-pink-light)', padding: '8px 16px',
        fontSize: 11, color: 'var(--joyt-pink)', flexShrink: 0,
        borderTop: '1px solid var(--joyt-border)',
      }}>
        ✎ Click any position badge to toggle on/off. Select tier from dropdown. Editable name and notes fields — changes save on blur.
      </div>
    </div>
  );
}
