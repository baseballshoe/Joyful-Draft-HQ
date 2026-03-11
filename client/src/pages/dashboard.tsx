import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { PosBadge, TagPill, ActionBtns, Card } from '@/components/game-ui';
import { useDraftState } from '@/hooks/use-draft';

// ── Stat chip ─────────────────────────────────────────────────────────────
function StatChip({ label, value, color, bg }: { label: string; value: any; color: string; bg: string }) {
  return (
    <div style={{
      background: bg, borderRadius: 10, padding: '10px 16px',
      borderLeft: `4px solid ${color}`, minWidth: 110,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--joyt-text-light)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Player row for target/sleeper lists ───────────────────────────────────
function PlayerListRow({ player, rank, accentColor, onUpdate }: any) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px', borderBottom: '1px solid var(--joyt-border)',
    }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: accentColor, minWidth: 20 }}>{rank}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <PosBadge pos={player.posDisplay} />
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--joyt-text)' }} title={player.name}>
            {player.name}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {(player.tagsArray ?? []).map((t: string) => <TagPill key={t} tag={t} />)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--joyt-amber)' }}>
          #{Math.round(player.priorityRank)}
        </div>
        <div style={{ marginTop: 4 }}>
          <ActionBtns player={player} onUpdate={onUpdate} size="sm" />
        </div>
      </div>
    </div>
  );
}

// ── Round chips ───────────────────────────────────────────────────────────
function RoundChip({ player, onUpdate }: any) {
  const tags: string[] = player.tagsArray ?? [];
  return (
    <div style={{
      background: 'var(--joyt-surface)', borderRadius: 8,
      padding: '8px 6px', flex: '0 0 calc((100% - 16px) / 5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <PosBadge pos={player.posDisplay} style={{ fontSize: 9 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--joyt-amber)' }}>
          #{Math.round(player.priorityRank)}
        </span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--joyt-text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.name}
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
          {tags.map((t: string) => <TagPill key={t} tag={t} />)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <ActionBtns player={player} onUpdate={onUpdate} size="sm" />
      </div>
    </div>
  );
}

// ── Quick Mark ────────────────────────────────────────────────────────────
function QuickMark({ onUpdate }: { onUpdate: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const data = await api.getPlayers({ search, status: 'available' });
      setResults(data.slice(0, 14));
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <input
        className="search-input"
        style={{ margin: '8px 10px', width: 'calc(100% - 20px)' }}
        placeholder="Search player…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        data-testid="input-quickmark-search"
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {results.map((p) => (
          <div key={p.id} style={{
            padding: '6px 10px', borderBottom: '1px solid var(--joyt-border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PosBadge pos={p.posDisplay} style={{ fontSize: 9 }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--joyt-amber)', marginRight: 4 }}>
                #{Math.round(p.priorityRank)}
              </span>
              <ActionBtns player={p} onUpdate={onUpdate} size="sm" />
            </div>
            {(p.tagsArray ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 3, marginTop: 3, marginLeft: 22, flexWrap: 'wrap' }}>
                {(p.tagsArray ?? []).map((t: string) => <TagPill key={t} tag={t} />)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── My Roster summary ─────────────────────────────────────────────────────
const ROSTER_SLOTS = [
  { pos: 'C', total: 1 }, { pos: '1B', total: 1 }, { pos: '2B', total: 1 },
  { pos: '3B', total: 1 }, { pos: 'SS', total: 1 }, { pos: 'OF', total: 4 },
  { pos: 'Util', total: 1 }, { pos: 'SP', total: 4 }, { pos: 'RP', total: 2 },
  { pos: 'P', total: 3 }, { pos: 'BN', total: 5 },
];

function RosterSummary({ myRoster }: { myRoster: any[] }) {
  const counts: Record<string, number> = {};
  myRoster.forEach((p) => {
    const slot = p.rosterSlot ?? p.posDisplay;
    counts[slot] = (counts[slot] ?? 0) + 1;
  });

  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {ROSTER_SLOTS.map(({ pos, total }) => {
        const filled = counts[pos] ?? 0;
        const pct = Math.min(filled / total, 1);
        const color = pct >= 1 ? 'var(--joyt-green)' : pct > 0 ? 'var(--joyt-amber)' : 'var(--joyt-border)';
        return (
          <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--joyt-text)', minWidth: 28 }}>{pos}</span>
            <div className="progress-bar" style={{ flex: 1 }}>
              <div className="fill" style={{ width: `${pct * 100}%`, background: color }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 28 }}>{filled}/{total}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Best by Position ──────────────────────────────────────────────────────
const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'];

function BestByPos({ bestByPos, onUpdate }: { bestByPos: Record<string, any>; onUpdate: () => void }) {
  return (
    <div style={{ padding: '4px 0' }}>
      {POSITIONS.map((pos) => {
        const p = bestByPos[pos];
        if (!p) return (
          <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderBottom: '1px solid var(--joyt-border)',
            color: 'var(--joyt-text-light)', fontSize: 11 }}>
            <PosBadge pos={pos} /><span>—</span>
          </div>
        );
        return (
          <div key={pos} style={{ padding: '7px 12px', borderBottom: '1px solid var(--joyt-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PosBadge pos={pos} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--joyt-amber)' }}>
                #{Math.round(p.priorityRank)}
              </span>
            </div>
            {(p.tagsArray ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 3, marginTop: 3, marginLeft: 28, flexWrap: 'wrap' }}>
                {(p.tagsArray ?? []).map((t: string) => <TagPill key={t} tag={t} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const { data: draftState } = useDraftState();

  const load = useCallback(async () => {
    const d = await api.getDashboard();
    setData(d);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handlePlayerUpdate() {
    load();
  }

  if (!data) return (
    <div style={{ padding: 40, color: 'var(--joyt-text-mid)' }}>Loading…</div>
  );

  const round = draftState?.currentRound ?? data.state?.currentRound ?? 1;
  const start = Math.max(1, round - 1);
  const roundNums = [start, start + 1, start + 2, start + 3];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Stat strip */}
      <div style={{
        background: 'var(--joyt-card)', borderBottom: '1px solid var(--joyt-border)',
        padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center',
        flexShrink: 0,
      }}>
        <StatChip label="Round"    value={round}                   color="var(--joyt-indigo)" bg="var(--joyt-indigo-light)" />
        <StatChip label="My Picks" value={data.myRoster?.length ?? 0}   color="var(--joyt-green)"  bg="var(--joyt-green-light)"  />
        <StatChip label="Drafted"  value={data.state?.drafted ?? '—'}   color="var(--joyt-text-mid)" bg="var(--joyt-surface)" />

        {/* Next best */}
        {data.nextBest && (
          <div style={{
            background: '#FFFBF0', borderRadius: 10, padding: '10px 16px',
            borderLeft: '4px solid var(--joyt-amber)', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--joyt-amber)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Next Best Available
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--joyt-text)', marginTop: 2 }}>
                {data.nextBest.name}
              </div>
            </div>
            <PosBadge pos={data.nextBest.posDisplay} />
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--joyt-amber)' }}>
              #{Math.round(data.nextBest.priorityRank)}
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                      background: 'var(--joyt-green-light)', padding: '6px 14px',
                      borderRadius: 20, color: 'var(--joyt-green)', fontWeight: 700 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--joyt-green)',
                         display: 'inline-block', boxShadow: '0 0 6px var(--joyt-green)' }} />
          Live Sync Active
        </div>
      </div>

      {/* Main grid */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 8,
        display: 'grid',
        gridTemplateColumns: '184px 190px 1fr 172px',
        gridTemplateRows: 'auto 1fr',
        gap: 8,
      }}>

        {/* Col A Row 1: My Roster */}
        <Card accent="var(--joyt-green)" title="My Roster" style={{ gridRow: 1, overflow: 'hidden' }}>
          <RosterSummary myRoster={data.myRoster ?? []} />
        </Card>

        {/* Col B: Top 10 Targets — spans both rows */}
        <Card accent="var(--joyt-pink)" title="Top 10 Targets"
          style={{ gridColumn: 2, gridRow: '1 / 3', overflowY: 'auto' }}>
          {(data.top10Targets ?? []).length === 0 && (
            <div style={{ padding: 16, color: 'var(--joyt-text-light)', fontSize: 12 }}>
              Tag players as "target" to see them here
            </div>
          )}
          {(data.top10Targets ?? []).map((p: any, i: number) => (
            <PlayerListRow key={p.id} player={p} rank={i + 1}
              accentColor="var(--joyt-pink)" onUpdate={handlePlayerUpdate} />
          ))}
        </Card>

        {/* Col C Row 1: Current Rounds */}
        <Card accent="var(--joyt-blue)" title="Best Available — Current Rounds"
          style={{ gridColumn: 3, gridRow: 1, overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roundNums.map((r) => {
              const players = (data.roundData ?? {})[r] ?? [];
              const pickStart = (r - 1) * 12 + 1;
              const pickEnd = r * 12;
              return (
                <div key={r}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      background: 'var(--joyt-blue-light)', color: 'var(--joyt-blue)',
                      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                    }}>ROUND {r}</span>
                    <span style={{ fontSize: 10, color: 'var(--joyt-text-light)' }}>picks {pickStart}-{pickEnd}</span>
                  </div>
                  <div style={{
                    display: 'flex', gap: 4,
                    overflowX: 'auto', paddingBottom: 4,
                  }}>
                    {players.length === 0
                      ? <span style={{ fontSize: 11, color: 'var(--joyt-text-light)' }}>No players available this round</span>
                      : players.map((p: any) => <RoundChip key={p.id} player={p} onUpdate={handlePlayerUpdate} />)
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Col D: Quick Mark — spans both rows */}
        <Card accent="var(--joyt-amber)" title="Quick Mark"
          style={{ gridColumn: 4, gridRow: '1 / 3', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <QuickMark onUpdate={handlePlayerUpdate} />
        </Card>

        {/* Col A Row 2: Best by Position */}
        <Card accent="var(--joyt-teal)" title="Best by Position"
          style={{ gridRow: 2, overflowY: 'auto' }}>
          <BestByPos bestByPos={data.bestByPos ?? {}} onUpdate={handlePlayerUpdate} />
        </Card>

        {/* Col C Row 2: Sleepers + Top 5 */}
        <div style={{ gridColumn: 3, gridRow: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Card accent="var(--joyt-purple)" title="Sleepers (tagged)" style={{ overflowY: 'auto' }}>
            {(data.sleepers ?? []).length === 0 && (
              <div style={{ padding: 16, color: 'var(--joyt-text-light)', fontSize: 12 }}>
                Tag players as "sleeper" to see them here
              </div>
            )}
            {(data.sleepers ?? []).map((p: any, i: number) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: '7px 10px', borderBottom: '1px solid var(--joyt-border)',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--joyt-purple)', minWidth: 18 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <PosBadge pos={p.posDisplay} style={{ fontSize: 9 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--joyt-text-light)' }}>
                      Rd {Math.ceil((p.consensusRank ?? 1) / 12)}
                    </span>
                    {(p.tagsArray ?? []).map((t: string) => <TagPill key={t} tag={t} />)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--joyt-amber)' }}>
                    #{Math.round(p.priorityRank)}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <ActionBtns player={p} onUpdate={handlePlayerUpdate} size="sm" />
                  </div>
                </div>
              </div>
            ))}
          </Card>

          <Card accent="var(--joyt-amber)" title="Top 5 Available" style={{ overflowY: 'auto' }}>
            {(data.top5 ?? []).map((p: any, i: number) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '10px 12px', borderBottom: '1px solid var(--joyt-border)',
              }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--joyt-amber)', minWidth: 24 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PosBadge pos={p.posDisplay} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</span>
                  </div>
                  {(p.tagsArray ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                      {(p.tagsArray ?? []).map((t: string) => <TagPill key={t} tag={t} />)}
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <ActionBtns player={p} onUpdate={handlePlayerUpdate} size="sm" />
                  </div>
                </div>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--joyt-amber)', flexShrink: 0 }}>
                  #{Math.round(p.priorityRank)}
                </span>
              </div>
            ))}
          </Card>
        </div>

      </div>
    </div>
  );
}
