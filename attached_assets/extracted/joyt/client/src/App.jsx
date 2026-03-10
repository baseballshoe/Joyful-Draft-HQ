import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Nav from './components/Nav.jsx';
import { useWS, api } from './lib/api.js';
import Dashboard from './pages/Dashboard.jsx';
import AllPlayers from './pages/AllPlayers.jsx';
import { ByPosition, MyRoster, CheatSheet, RoundStrategy } from './pages/Pages.jsx';

export default function App() {
  const [wsConnected,  setWsConnected]  = useState(false);
  const [draftState,   setDraftState]   = useState(null);

  useEffect(() => {
    api.getDraftState().then(setDraftState);
  }, []);

  // WebSocket — handles all server-push events
  useWS(useCallback((msg) => {
    setWsConnected(true);
    if (msg.type === 'draft_state') setDraftState(msg.data);
    // player_updated / cheat_sheet_updated / round_strategy_updated
    // are handled inside each page via their own refresh logic
  }, []));

  async function handleRankModeChange(mode) {
    const updated = await api.patchDraftState({ rank_mode: mode });
    setDraftState(updated);
  }

  return (
    <BrowserRouter>
      <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
        <Nav
          wsConnected={wsConnected}
          draftState={draftState}
          onRankModeChange={handleRankModeChange}
        />
        <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <Routes>
            <Route path="/"               element={<Dashboard draftState={draftState} onDraftStateChange={setDraftState} />} />
            <Route path="/players"        element={<AllPlayers />} />
            <Route path="/by-position"    element={<ByPosition />} />
            <Route path="/my-roster"      element={<MyRoster />} />
            <Route path="/cheat-sheet"    element={<CheatSheet />} />
            <Route path="/round-strategy" element={<RoundStrategy />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
