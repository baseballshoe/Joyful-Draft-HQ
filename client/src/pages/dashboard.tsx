import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
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

// ── Position filter bar ───────────────────────────────────────────────────
const POS_OPTS = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'];
function PosFilterBar({ value, onChange, accent = 'var(--joyt-blue)' }: {
  value: string; onChange: (p: string) => void; accent?: string;
}) {
  return (
    <div style={{
      display: 'flex', gap: 3, padding: '4px 10px 6px', flexWrap: 'wrap',
      borderBottom: '1px solid var(--joyt-border)', flexShrink: 0,
    }}>
      {POS_OPTS.map((pos) => (
        <button key={pos} onClick={() => onChange(pos)} style={{
          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
          border: `1px solid ${value === pos ? accent : 'var(--joyt-border)'}`,
          background: value === pos ? `color-mix(in srgb, ${accent} 15%, transparent)` : 'var(--joyt-surface)',
          color: value === pos ? accent : 'var(--joyt-text-light)',
        }}>
          {pos}
        </button>
      ))}
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
      <span style={{ fontSize: 14, fontWeight: 700, color: accentColor, minWidth: 20, flexShrink: 0 }}>{rank}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PosBadge pos={player.posDisplay} />
          <span style={{
            fontWeight: 700, fontSize: 13, color: 'var(--joyt-text)',
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={player.name}>
            {player.name}
          </span>
          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--joyt-amber)', flexShrink: 0 }}>
            #{Math.round(player.priorityRank)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {(player.tagsArray ?? []).map((t: string) => <TagPill key={t} tag={t} />)}
          <ActionBtns player={player} onUpdate={onUpdate} size="sm" />
        </div>
      </div>
    </div>
  );
}

// ── Round chips ───────────────────────────────────────────────────────────
function RoundChip({ player, onUpdate, chipWidth }: any) {
  const tags: string[] = player.tagsArray ?? [];
  return (
    <div style={{
      background: 'var(--joyt-surface)', borderRadius: 8,
      padding: '8px 6px', flexShrink: 0,
      width: chipWidth, minWidth: 0, overflow: 'hidden',
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
      <div style={{ fontSize: 10, color: 'var(--joyt-text-light)', marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.team}
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

// ── Round chip row — measures its own width so chips always fill exactly ──
const GAP = 4;
const VISIBLE = 5;
function RoundChipRow({ players, onUpdate }: { players: any[]; onUpdate: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [chipWidth, setChipWidth] = useState(116);

  useLayoutEffect(() => {
    if (!viewportRef.current) return;
    const calc = (w: number) => w > 20 ? Math.floor((w - GAP * (VISIBLE - 1)) / VISIBLE) : 116;
    const measure = () => {
      const w = viewportRef.current?.getBoundingClientRect().width ?? 0;
      setChipWidth(calc(w));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(viewportRef.current);
    return () => obs.disconnect();
  }, []);

  const scroll = (dir: -1 | 1) => {
    viewportRef.current?.scrollBy({ left: dir * (chipWidth + GAP) * VISIBLE, behavior: 'smooth' });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px 4px' }}>
      <button className="scroll-nav-btn" onClick={() => scroll(-1)}>‹</button>
      <div ref={viewportRef} className="no-scrollbar" style={{ flex: 1, overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: GAP }}>
          {players.map((p: any) => (
            <RoundChip key={p.id} player={p} onUpdate={onUpdate} chipWidth={chipWidth} />
          ))}
        </div>
      </div>
      <button className="scroll-nav-btn" onClick={() => scroll(1)}>›</button>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <PosBadge pos={p.posDisplay} style={{ fontSize: 9 }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--joyt-amber)', marginRight: 2 }}>
                #{Math.round(p.priorityRank)}
              </span>
              <ActionBtns player={p} onUpdate={onUpdate} size="sm" />
            </div>
            {(p.tagsArray ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 3, marginTop: 3, marginLeft: 2, flexWrap: 'wrap' }}>
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
  const bySlot: Record<string, any[]> = {};
  myRoster.forEach((p) => {
    const slot = p.rosterSlot ?? p.posDisplay;
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(p);
  });

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ROSTER_SLOTS.map(({ pos, total }) => {
        const players = bySlot[pos] ?? [];
        const filled = players.length;
        const pct = Math.min(filled / total, 1);
        const color = pct >= 1 ? 'var(--joyt-green)' : pct > 0 ? 'var(--joyt-amber)' : 'var(--joyt-border)';
        return (
          <div key={pos}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: players.length > 0 ? 3 : 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--joyt-text)', minWidth: 28 }}>{pos}</span>
              <div className="progress-bar" style={{ flex: 1 }}>
                <div className="fill" style={{ width: `${pct * 100}%`, background: color }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 28 }}>{filled}/{total}</span>
            </div>
            {players.map((p) => (
              <div key={p.id} style={{
                fontSize: 10, color: 'var(--joyt-text-mid)', fontWeight: 600,
                paddingLeft: 36, marginBottom: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.name}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── My draft pick schedule (snake draft, pick 4 in a 12-team league) ──────
const MY_PICKS = [4, 21, 28, 45, 52, 69, 76, 93, 100, 117, 124, 141, 148, 165, 172];

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
  const picksScrollRef = useRef<HTMLDivElement>(null);

  // Position filters for the three list sections
  const [targetPos,    setTargetPos]    = useState('ALL');
  const [sleeperPos,   setSleeperPos]   = useState('ALL');
  const [bestAvailPos, setBestAvailPos] = useState('ALL');

  const load = useCallback(async () => {
    const d = await api.getDashboard();
    setData(d);
  }, []);

  useEffect(() => { load(); }, [load]);

  const round = data?.dynamicRound ?? draftState?.currentRound ?? data?.state?.currentRound ?? 1;

  const prevRoundRef = useRef(round);
  useEffect(() => {
    if (prevRoundRef.current !== round) {
      prevRoundRef.current = round;
      load();
    }
  }, [round, load]);

  useEffect(() => {
    const timer = setInterval(load, 30 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  function handlePlayerUpdate() {
    load();
  }

  if (!data) return (
    <div style={{ padding: 40, color: 'var(--joyt-text-mid)' }}>Loading…</div>
  );

  const roundNums = Array.from({ length: 20 }, (_, i) => i + 1);

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
        <StatChip label="Drafted"  value={data.totalDrafted ?? 0}        color="var(--joyt-text-mid)" bg="var(--joyt-surface)" />

        {/* Next best */}
        {data.nextBest && (
          <div style={{
            background: 'var(--joyt-amber-light)', borderRadius: 10, padding: '10px 16px',
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

        {/* My pick schedule */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--joyt-text-light)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>My Picks</span>
          <button className="scroll-nav-btn" onClick={() => picksScrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}>‹</button>
          <div ref={picksScrollRef} className="no-scrollbar" style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
            {MY_PICKS.map((pick, i) => {
              const roundNum = i + 1;
              const isCurrent = roundNum === round;
              const isPast = roundNum < round;
              return (
                <div key={pick} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '3px 7px', borderRadius: 6, flexShrink: 0,
                  background: isCurrent ? 'var(--joyt-amber-light)' : isPast ? 'transparent' : 'var(--joyt-surface)',
                  border: `1px solid ${isCurrent ? 'var(--joyt-amber)' : 'transparent'}`,
                  opacity: isPast ? 0.4 : 1,
                }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: isCurrent ? 'var(--joyt-amber)' : 'var(--joyt-text-light)' }}>
                    R{roundNum}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isCurrent ? 'var(--joyt-amber)' : 'var(--joyt-text)' }}>
                    {pick}
                  </span>
                </div>
              );
            })}
          </div>
          <button className="scroll-nav-btn" onClick={() => picksScrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}>›</button>
        </div>

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
        gridTemplateRows: '1fr 1fr',
        gap: 8,
      }}>

        {/* Col A: My Roster — spans both rows, shows player names + progress bars */}
        <Card accent="var(--joyt-green)" title="My Roster"
          style={{ gridColumn: 1, gridRow: '1 / 3', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ flex: 1, overflowY: 'auto' }}>
          <RosterSummary myRoster={data.myRoster ?? []} />
        </Card>

        {/* Col B: My Targets — spans both rows, scrolls to show all tagged targets */}
        <Card accent="var(--joyt-pink)" title="My Targets"
          style={{ gridColumn: 2, gridRow: '1 / 3', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <PosFilterBar value={targetPos} onChange={setTargetPos} accent="var(--joyt-pink)" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(() => {
              const list = (data.top10Targets ?? []).filter((p: any) => targetPos === 'ALL' || p.posDisplay === targetPos);
              if (list.length === 0) return (
                <div style={{ padding: 16, color: 'var(--joyt-text-light)', fontSize: 12 }}>
                  {targetPos === 'ALL' ? 'Tag players as "target" to see them here' : `No ${targetPos} targets tagged`}
                </div>
              );
              return list.map((p: any, i: number) => (
                <PlayerListRow key={p.id} player={p} rank={i + 1}
                  accentColor="var(--joyt-pink)" onUpdate={handlePlayerUpdate} />
              ));
            })()}
          </div>
        </Card>

        {/* Col C Row 1: Current Rounds */}
        <Card accent="var(--joyt-blue)" title="Best Available — Current Rounds"
          style={{ gridColumn: 3, gridRow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <PosFilterBar value={bestAvailPos} onChange={setBestAvailPos} accent="var(--joyt-blue)" />
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roundNums.map((r) => {
              const allPlayers = (data.roundData ?? {})[r] ?? [];
              const players = bestAvailPos === 'ALL' ? allPlayers : allPlayers.filter((p: any) => p.posDisplay === bestAvailPos);
              const pickStart = (r - 1) * 12 + 1;
              const pickEnd = r * 12;
              if (players.length === 0) return null;
              return (
                <div key={r}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, padding: '0 10px' }}>
                    <span style={{
                      background: 'var(--joyt-blue-light)', color: 'var(--joyt-blue)',
                      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                    }}>ROUND {r}</span>
                    <span style={{ fontSize: 10, color: 'var(--joyt-text-light)' }}>picks {pickStart}-{pickEnd}</span>
                  </div>
                  <RoundChipRow players={players} onUpdate={handlePlayerUpdate} />
                </div>
              );
            })}
          </div>
        </Card>

        {/* Col D Row 1: Quick Mark */}
        <Card accent="var(--joyt-amber)" title="Quick Mark"
          style={{ gridColumn: 4, gridRow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <QuickMark onUpdate={handlePlayerUpdate} />
        </Card>

        {/* Col D Row 2: Best by Position */}
        <Card accent="var(--joyt-teal)" title="Best by Position"
          style={{ gridColumn: 4, gridRow: 2, overflowY: 'auto' }}>
          <BestByPos bestByPos={data.bestByPos ?? {}} onUpdate={handlePlayerUpdate} />
        </Card>

        {/* Col C Row 2: Sleepers + Top 5 */}
        <div style={{ gridColumn: 3, gridRow: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Card accent="var(--joyt-purple)" title="Sleepers (tagged)"
            style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <PosFilterBar value={sleeperPos} onChange={setSleeperPos} accent="var(--joyt-purple)" />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(() => {
                const list = (data.sleepers ?? []).filter((p: any) => sleeperPos === 'ALL' || p.posDisplay === sleeperPos);
                if (list.length === 0) return (
                  <div style={{ padding: 16, color: 'var(--joyt-text-light)', fontSize: 12 }}>
                    {sleeperPos === 'ALL' ? 'Tag players as "sleeper" to see them here' : `No ${sleeperPos} sleepers tagged`}
                  </div>
                );
                return list.map((p: any, i: number) => (
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
                ));
              })()}
            </div>
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
