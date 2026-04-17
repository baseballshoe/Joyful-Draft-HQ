import { useState } from 'react';
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AppLayout } from "./components/layout";
import Dashboard from "./pages/dashboard";
import Players from "./pages/players";
import ByPosition from "./pages/by-position";
import MyRoster from "./pages/my-roster";
import CheatSheet from "./pages/cheat-sheet";
import RoundStrategy from "./pages/round-strategy";
import YahooSettings from './pages/yahoo-settings';

const PASSWORD = 'drafthqjoyt';
const STORAGE_KEY = 'joyt_auth';

function PasswordGate({ onAuth }: { onAuth: () => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === PASSWORD) {
      localStorage.setItem(STORAGE_KEY, '1');
      onAuth();
    } else {
      setError(true);
      setInput('');
    }
  }

  return (
    <div style={{
      height: '100vh', width: '100vw',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'var(--joyt-bg)',
    }}>
      <div style={{
        background: 'var(--joyt-card)', border: '1px solid var(--joyt-border)',
        borderRadius: 12, padding: '36px 40px', width: 340,
        display: 'flex', flexDirection: 'column', gap: 20,
        boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--joyt-indigo)', letterSpacing: '-0.5px' }}>
            JOYT Draft HQ
          </div>
          <div style={{ fontSize: 13, color: 'var(--joyt-text-mid)', marginTop: 4 }}>
            Jazz On Your Tatis — Fantasy Baseball
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--joyt-text-light)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Password
            </label>
            <input
              className="search-input"
              type="password"
              style={{ width: '100%', fontSize: 15, padding: '9px 12px' }}
              placeholder="Enter password…"
              value={input}
              autoFocus
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              data-testid="input-password"
            />
            {error && (
              <span style={{ fontSize: 12, color: 'var(--joyt-red)', fontWeight: 600 }} data-testid="text-password-error">
                Incorrect password — try again.
              </span>
            )}
          </div>
          <button
            className="btn"
            type="submit"
            style={{ background: 'var(--joyt-indigo)', color: '#fff', padding: '9px', fontSize: 14, fontWeight: 700 }}
            data-testid="button-login">
            Enter Draft Room
          </button>
        </form>
      </div>
    </div>
  );
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/players" component={Players} />
        <Route path="/by-position" component={ByPosition} />
        <Route path="/my-roster" component={MyRoster} />
        <Route path="/cheat-sheet" component={CheatSheet} />
        <Route path="/round-strategy" component={RoundStrategy} />
        <Route path="/yahoo" component={YahooSettings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  const [authed, setAuthed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {authed ? <Router /> : <PasswordGate onAuth={() => setAuthed(true)} />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
