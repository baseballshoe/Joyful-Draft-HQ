import { Link, useLocation } from "wouter";
import { useDraftState, useUpdateDraftState } from "@/hooks/use-draft";
import { useWebSocket } from "@/hooks/use-websocket";

const TABS = [
  { path: '/',               label: 'Dashboard'      },
  { path: '/players',        label: 'All Players'    },
  { path: '/by-position',    label: 'By Position'    },
  { path: '/my-roster',      label: 'My Roster'      },
  { path: '/cheat-sheet',    label: 'Cheat Sheet'    },
  { path: '/round-strategy', label: 'Round Strategy' },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: draftState } = useDraftState();
  const updateDraftState = useUpdateDraftState();
  const { connected } = useWebSocket();

  function handleRankModeChange(mode: string) {
    updateDraftState.mutate({ rankMode: mode });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top Nav */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--joyt-header)',
        borderBottom: '1px solid var(--joyt-header-sep)',
        height: 'var(--nav-h)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 0,
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 24, flexShrink: 0 }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>💧</span>
          <span style={{
            fontStyle: 'italic', fontWeight: 700, fontSize: 15,
            color: 'var(--joyt-pink)', letterSpacing: '.02em',
          }}>
            JAZZ ON YOUR TATIS
          </span>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {TABS.map(({ path, label }) => {
            const active = location === path;
            return (
              <Link key={path} href={path} style={{ textDecoration: 'none' }}>
                <span style={{
                  display: 'block', padding: '6px 14px',
                  borderRadius: 8,
                  background: active ? 'var(--joyt-pink)' : 'transparent',
                  color: active ? '#fff' : '#8B909A',
                  fontSize: 12, fontWeight: active ? 700 : 400,
                  transition: 'all .15s',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Rank mode selector */}
          {draftState && (
            <select
              value={draftState.rankMode ?? 'priority'}
              onChange={(e) => handleRankModeChange(e.target.value)}
              style={{ fontSize: 11 }}
              title="Rank mode for all recommendations"
              data-testid="select-rank-mode"
            >
              <option value="priority">Priority Rank</option>
              <option value="consensus">Consensus Rank</option>
            </select>
          )}
          {/* Live sync indicator */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
            color: connected ? 'var(--joyt-green)' : 'var(--joyt-text-mid)',
          }}
          data-testid="status-live-sync">
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'var(--joyt-green)' : '#555',
              boxShadow: connected ? '0 0 6px var(--joyt-green)' : 'none',
              display: 'inline-block',
            }} />
            {connected ? 'Live Sync' : 'Connecting…'}
          </span>
        </div>
      </header>

      {/* Page content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}
