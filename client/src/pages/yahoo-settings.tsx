// client/src/pages/yahoo-settings.tsx
// ─────────────────────────────────────
// Yahoo Fantasy Sports connection & sync page.
// Add to your router in App.tsx:
//   import YahooSettings from './pages/yahoo-settings';
//   <Route path="/yahoo" component={YahooSettings} />
// Add to Nav tabs array:
//   { path: '/yahoo', label: 'Yahoo ⚾' }

import { useState, useEffect } from 'react';

interface YahooStatus {
  connected: boolean;
  yahooGuid?: string;
  expiresAt?: string;
  league?: {
    leagueKey: string;
    name: string;
    season: string;
    numTeams: number;
    myTeamName: string;
    lastSyncedAt: string | null;
  } | null;
}

interface YahooLeague {
  leagueKey:   string;
  leagueId:    string;
  name:        string;
  season:      string;
  numTeams:    number;
  scoringType: string;
}

export default function YahooSettings() {
  const [status,       setStatus]       = useState<YahooStatus | null>(null);
  const [leagues,      setLeagues]      = useState<YahooLeague[]>([]);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [syncResult,   setSyncResult]   = useState<{ synced: number; removed: number; unmatched: string[] } | null>(null);
  const [error,        setError]        = useState<string | null>(null);

  // Check for OAuth redirect params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('yahoo_connected') === '1') {
      window.history.replaceState({}, '', window.location.pathname);
      loadStatus();
    } else if (params.get('yahoo_error')) {
      setError(decodeURIComponent(params.get('yahoo_error')!));
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      loadStatus();
    }
  }, []);

  async function loadStatus() {
    try {
      const data = await fetch('/api/yahoo/status').then(r => r.json());
      setStatus(data);
      if (data.connected && !data.league) {
        // Connected but no league selected — load league list
        loadLeagues();
      }
    } catch {
      setStatus({ connected: false });
    }
  }

  async function loadLeagues() {
    setLoadingLeagues(true);
    setError(null);
    try {
      const data = await fetch('/api/yahoo/leagues').then(r => r.json());
      if (data.message) throw new Error(data.message);
      setLeagues(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingLeagues(false);
    }
  }

  async function selectLeague(league: YahooLeague) {
    setError(null);
    try {
      const res = await fetch('/api/yahoo/league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(league),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      loadStatus();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function syncRoster() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch('/api/yahoo/sync-roster', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSyncResult(data);
      loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    await fetch('/api/auth/yahoo', { method: 'DELETE' });
    setStatus({ connected: false });
    setLeagues([]);
    setSyncResult(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--joyt-text)', marginBottom: 4 }}>
            Yahoo Fantasy Baseball
          </h2>
          <p style={{ fontSize: 13, color: 'var(--joyt-text-mid)' }}>
            Connect your Yahoo league to sync your roster, stats, and waiver wire.
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ background: 'var(--joyt-red-light)', color: 'var(--joyt-red)', padding: '10px 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--joyt-red)' }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Not connected ── */}
        {status && !status.connected && (
          <div className="joyt-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 48 }}>⚾</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Connect your Yahoo league</div>
              <div style={{ fontSize: 13, color: 'var(--joyt-text-mid)', maxWidth: 400 }}>
                Sign in with Yahoo to sync your roster, see live stats, and unlock AI analysis tailored to your specific team and matchup.
              </div>
            </div>
            <a
              href="/api/auth/yahoo"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#6001D2', color: '#fff',
                padding: '10px 24px', borderRadius: 8,
                fontWeight: 700, fontSize: 14, textDecoration: 'none',
                transition: 'opacity .15s',
              }}
              onMouseOver={e => (e.currentTarget.style.opacity = '.85')}
              onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            >
              <span style={{ fontSize: 18 }}>Y!</span> Sign in with Yahoo
            </a>
            <div style={{ fontSize: 11, color: 'var(--joyt-text-light)' }}>
              Read-only access — JOYT never modifies your Yahoo league
            </div>
          </div>
        )}

        {/* ── Connected, no league yet — show league picker ── */}
        {status?.connected && !status.league && (
          <div className="joyt-card" style={{ overflow: 'hidden' }}>
            <div className="joyt-card-header">
              <span className="dot" style={{ background: 'var(--joyt-green)' }} />
              <h3>Connected to Yahoo — Select your league</h3>
            </div>
            <div style={{ padding: 16 }}>
              {loadingLeagues && (
                <div style={{ color: 'var(--joyt-text-mid)', fontSize: 13 }}>Loading your leagues…</div>
              )}
              {!loadingLeagues && leagues.length === 0 && (
                <div style={{ color: 'var(--joyt-text-mid)', fontSize: 13 }}>
                  No fantasy baseball leagues found for your account.
                  <button
                    onClick={loadLeagues}
                    style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--joyt-blue)', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                    Retry
                  </button>
                </div>
              )}
              {leagues.map(league => (
                <div key={league.leagueKey} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 0', borderBottom: '1px solid var(--joyt-border)',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{league.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--joyt-text-mid)', marginTop: 2 }}>
                      {league.season} · {league.numTeams} teams · {league.scoringType}
                    </div>
                  </div>
                  <button
                    className="btn btn-mine"
                    style={{ padding: '6px 16px', fontSize: 12 }}
                    onClick={() => selectLeague(league)}>
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Connected with league — main sync panel ── */}
        {status?.connected && status.league && (
          <>
            {/* League info card */}
            <div className="joyt-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--joyt-green)', boxShadow: '0 0 6px var(--joyt-green)', display: 'inline-block' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--joyt-green)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Connected</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{status.league.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--joyt-text-mid)', marginTop: 4, display: 'flex', gap: 16 }}>
                    <span>{status.league.season} season</span>
                    <span>{status.league.numTeams} teams</span>
                    {status.league.myTeamName && <span>Your team: <strong>{status.league.myTeamName}</strong></span>}
                  </div>
                  {status.league.lastSyncedAt && (
                    <div style={{ fontSize: 11, color: 'var(--joyt-text-light)', marginTop: 4 }}>
                      Last synced: {new Date(status.league.lastSyncedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <button
                  onClick={disconnect}
                  style={{ background: 'none', border: '1px solid var(--joyt-border)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 11, color: 'var(--joyt-text-light)', fontFamily: 'var(--font-sans)' }}>
                  Disconnect
                </button>
              </div>
            </div>

            {/* Sync roster card */}
            <div className="joyt-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Sync Roster</div>
                  <div style={{ fontSize: 12, color: 'var(--joyt-text-mid)', marginTop: 2 }}>
                    Pulls your current Yahoo roster and marks those players as "Mine" in your draft board.
                  </div>
                </div>
                <button
                  className="btn btn-mine"
                  style={{ padding: '8px 18px', fontSize: 13, flexShrink: 0 }}
                  onClick={syncRoster}
                  disabled={syncing}>
                  {syncing ? 'Syncing…' : '⟳ Sync Now'}
                </button>
              </div>

              {syncResult && (
                <div style={{ background: 'var(--joyt-green-light)', borderRadius: 7, padding: '10px 14px', fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: 'var(--joyt-green)', marginBottom: 4 }}>
                    ✓ Synced {syncResult.synced} players to roster
                    {syncResult.removed > 0 && `, removed ${syncResult.removed} no longer on team`}
                  </div>
                  {syncResult.unmatched.length > 0 && (
                    <div style={{ color: 'var(--joyt-amber)', marginTop: 4 }}>
                      ⚠ Could not match {syncResult.unmatched.length} player{syncResult.unmatched.length !== 1 ? 's' : ''}:&nbsp;
                      {syncResult.unmatched.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* What's coming next */}
            <div className="joyt-card" style={{ padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Coming soon</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: '📊', label: 'Live season stats', desc: 'AVG, HR, SB, RBI, R, QS, ERA, WHIP, K for every player on your roster' },
                  { icon: '🔄', label: 'Waiver wire', desc: 'Top available players in your league ranked by your priority system' },
                  { icon: '📈', label: 'Standings & matchups', desc: 'Your current H2H record, category breakdown, and this week\'s opponent' },
                  { icon: '🤖', label: 'AI analysis', desc: 'Ask Claude about your roster using your real Yahoo data' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--joyt-text-mid)', marginTop: 1 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Loading state */}
        {!status && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--joyt-text-mid)' }}>
            Loading…
          </div>
        )}

      </div>
    </div>
  );
}
