import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { PosBadge, TagPill, TagSelector, ActionBtns, StatusPill, EditableRank } from '@/components/game-ui';

const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'];
const STATUSES  = ['all', 'available', 'mine', 'drafted'];
const TAGS      = ['all', 'sleeper', 'target', 'watch', 'injured', 'skip'];

export default function Players() {
  const [players, setPlayers] = useState<any[]>([]);
  const [search,  setSearch]  = useState('');
  const [pos,     setPos]     = useState('All');
  const [status,  setStatus]  = useState('all');
  const [tag,     setTag]     = useState('all');
  const [loading, setLoading] = useState(true);

  const [showImport, setShowImport] = useState(false);
  const [fpFile,    setFpFile]    = useState<File | null>(null);
  const [espnFile,  setEspnFile]  = useState<File | null>(null);
  const [yahooFile, setYahooFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const fpRef    = useRef<HTMLInputElement>(null);
  const espnRef  = useRef<HTMLInputElement>(null);
  const yahooRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    if (!fpFile && !espnFile && !yahooFile) {
      setImportMsg({ text: 'Please attach at least one file.', ok: false });
      return;
    }
    setImporting(true);
    setImportMsg(null);
    try {
      const form = new FormData();
      if (fpFile)    form.append('fpFile',    fpFile);
      if (espnFile)  form.append('espnFile',  espnFile);
      if (yahooFile) form.append('yahooFile', yahooFile);
      const res = await fetch('/api/import', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Import failed');
      const parts = [];
      if (json.parsed?.fp)    parts.push(`FP: ${json.parsed.fp}`);
      if (json.parsed?.espn)  parts.push(`ESPN: ${json.parsed.espn}`);
      if (json.parsed?.yahoo) parts.push(`Yahoo: ${json.parsed.yahoo}`);
      const parsedInfo = parts.length ? ` (${parts.join(', ')} parsed)` : '';
      const espnColInfo = json.espnRankCol ? ` · ESPN rank col: "${json.espnRankCol}"` : '';
      const unmatchedInfo = json.unmatchedEspn?.length
        ? ` ⚠ ${json.unmatchedEspn.length} ESPN name(s) not matched: ${json.unmatchedEspn.join(', ')}`
        : '';
      setImportMsg({ text: `✓ Import complete — ${json.updated} updated, ${json.inserted} new.${parsedInfo}${espnColInfo}${unmatchedInfo}`, ok: json.unmatchedEspn?.length === 0 });
      setFpFile(null); setEspnFile(null); setYahooFile(null);
      if (fpRef.current)    fpRef.current.value    = '';
      if (espnRef.current)  espnRef.current.value  = '';
      if (yahooRef.current) yahooRef.current.value = '';
      load();
    } catch (err: any) {
      setImportMsg({ text: err.message || 'Import failed.', ok: false });
    } finally {
      setImporting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (pos    !== 'All') params.pos    = pos;
    if (status !== 'all') params.status = status;
    if (tag    !== 'all') params.tag    = tag;
    if (search)           params.search = search;
    const data = await api.getPlayers(params);
    setPlayers(data);
    setLoading(false);
  }, [pos, status, tag, search]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  function updateLocal(updated: any) {
    setPlayers((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  const statusColors: Record<string, string> = {
    available: 'active-green', mine: 'active-blue', drafted: 'active-red', all: '',
  };
  const tagColors: Record<string, string> = {
    sleeper: 'active-purple', target: 'active-amber', watch: 'active-blue',
    injured: 'active-orange', skip: 'active-red', all: '',
  };

  const importFieldStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 5,
    background: '#fff', border: '1px solid var(--joyt-border)',
    borderRadius: 6, padding: '10px 12px', cursor: 'default',
  };
  const importLabelStyle: React.CSSProperties = {
    fontWeight: 700, fontSize: 12, color: 'var(--joyt-text)', display: 'flex', gap: 6, alignItems: 'center',
  };
  const importInputStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--joyt-text-mid)',
    border: '1px dashed var(--joyt-border)', borderRadius: 4,
    padding: '4px 6px', background: '#F7F8FF', cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Filter bar */}
      <div style={{
        background: 'var(--joyt-card)', borderBottom: '1px solid var(--joyt-border)',
        padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
      }}>
        {/* Row 1: search + position pills */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="search-input"
            style={{ width: 220 }}
            placeholder="Search name or team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-player-search"
          />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => (
              <button key={p}
                className={`filter-pill ${pos === p ? 'active' : ''}`}
                onClick={() => setPos(p)}
                data-testid={`filter-pos-${p.toLowerCase()}`}>
                {p}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            {STATUSES.map((s) => (
              <button key={s}
                className={`filter-pill ${status === s ? (statusColors[s] || 'active') : ''}`}
                onClick={() => setStatus(s)}
                style={{ textTransform: 'capitalize' }}
                data-testid={`filter-status-${s}`}>
                {s === 'all' ? 'All Status' : s === 'mine' ? 'My Picks' : s === 'drafted' ? 'Drafted' : 'Available'}
              </button>
            ))}
            <button
              className={`filter-pill ${showImport ? 'active' : ''}`}
              onClick={() => { setShowImport(v => !v); setImportMsg(null); }}
              style={{ marginLeft: 8, fontWeight: 700 }}
              data-testid="button-toggle-import">
              📥 Import Rankings
            </button>
          </div>
        </div>

        {/* Row 2: tag filters */}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          background: 'var(--joyt-pink-light)', padding: '5px 8px', borderRadius: 6,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--joyt-pink)', marginRight: 4 }}>TAGS</span>
          {TAGS.map((t) => (
            <button key={t}
              className={`filter-pill ${tag === t ? (tagColors[t] || 'active') : ''}`}
              onClick={() => setTag(t)}
              data-testid={`filter-tag-${t}`}>
              {t === 'all' ? 'All Tags' : t}
            </button>
          ))}
        </div>

        {/* Tip */}
        <div style={{ fontSize: 11, color: 'var(--joyt-blue)', background: 'var(--joyt-blue-light)',
                      padding: '4px 10px', borderRadius: 5 }}>
          ✎ Click MY RANK, ROUND ✎, or MY POS ✎ cells to edit inline — press Enter or click away to save
        </div>

        {/* Import Panel */}
        {showImport && (
          <div style={{
            background: '#FAFBFF', border: '1.5px solid var(--joyt-border)',
            borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12,
          }} data-testid="panel-import">
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--joyt-text)' }}>
              📥 Import Player Rankings
            </div>
            <div style={{ fontSize: 11, color: 'var(--joyt-text-mid)', lineHeight: 1.5 }}>
              Upload your ranking files below. All three are optional — upload whichever you have.
              Your existing draft picks, tags, and custom ranks will <strong>not</strong> be changed.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {/* FantasyPros */}
              <label style={importFieldStyle}>
                <span style={importLabelStyle}>
                  <span style={{ background: '#4FC3F7', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>FP</span>
                  FantasyPros CSV
                </span>
                <span style={{ fontSize: 10, color: 'var(--joyt-text-light)' }}>
                  Columns: RK, PLAYER NAME, TEAM, POS
                </span>
                <input
                  ref={fpRef} type="file" accept=".csv"
                  style={importInputStyle}
                  data-testid="input-fp-file"
                  onChange={(e) => setFpFile(e.target.files?.[0] ?? null)}
                />
                {fpFile && <span style={{ fontSize: 11, color: 'var(--joyt-green)', fontWeight: 600 }}>✓ {fpFile.name}</span>}
              </label>

              {/* ESPN */}
              <label style={importFieldStyle}>
                <span style={importLabelStyle}>
                  <span style={{ background: '#EF5350', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>ESPN</span>
                  ESPN XLSX
                </span>
                <span style={{ fontSize: 10, color: 'var(--joyt-text-light)' }}>
                  Columns: Rank, Name, Team, Position, Auction Value
                </span>
                <input
                  ref={espnRef} type="file" accept=".xlsx,.xls"
                  style={importInputStyle}
                  data-testid="input-espn-file"
                  onChange={(e) => setEspnFile(e.target.files?.[0] ?? null)}
                />
                {espnFile && <span style={{ fontSize: 11, color: 'var(--joyt-green)', fontWeight: 600 }}>✓ {espnFile.name}</span>}
              </label>

              {/* Yahoo */}
              <label style={importFieldStyle}>
                <span style={importLabelStyle}>
                  <span style={{ background: '#7B1FA2', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>YHO</span>
                  Yahoo XLSX or CSV
                </span>
                <span style={{ fontSize: 10, color: 'var(--joyt-text-light)' }}>
                  Export from Yahoo Fantasy → "Rankings" tab. Column headers auto-detected.
                </span>
                <input
                  ref={yahooRef} type="file" accept=".xlsx,.xls,.csv"
                  style={importInputStyle}
                  data-testid="input-yahoo-file"
                  onChange={(e) => setYahooFile(e.target.files?.[0] ?? null)}
                />
                {yahooFile && <span style={{ fontSize: 11, color: 'var(--joyt-green)', fontWeight: 600 }}>✓ {yahooFile.name}</span>}
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                className="btn"
                onClick={handleImport}
                disabled={importing}
                style={{ background: 'var(--joyt-pink)', color: '#fff', opacity: importing ? 0.6 : 1 }}
                data-testid="button-run-import">
                {importing ? 'Importing…' : 'Run Import'}
              </button>
              <button
                className="btn"
                onClick={() => { setShowImport(false); setImportMsg(null); setFpFile(null); setEspnFile(null); setYahooFile(null); }}
                style={{ background: 'var(--joyt-bg)', color: 'var(--joyt-text-mid)' }}>
                Cancel
              </button>
              {importMsg && (
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: importMsg.ok ? 'var(--joyt-green)' : 'var(--joyt-red)',
                }} data-testid="text-import-result">
                  {importMsg.text}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, color: 'var(--joyt-text-mid)', textAlign: 'center' }}>Loading…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 46 }}>#RNK</th>
                <th style={{ width: 44 }}>CON</th>
                <th style={{ width: 38 }}>FP</th>
                <th style={{ width: 44 }}>ESPN</th>
                <th style={{ width: 44 }}>YHO</th>
                <th style={{ minWidth: 160 }}>PLAYER</th>
                <th style={{ width: 48 }}>POS</th>
                <th style={{ width: 52 }}>TEAM</th>
                <th style={{ width: 84 }}>MY RANK</th>
                <th style={{ width: 80 }}>ROUND ✎</th>
                <th style={{ width: 86 }}>MY POS ✎</th>
                <th style={{ minWidth: 120 }}>TAGS</th>
                <th style={{ width: 90 }}>STATUS</th>
                <th style={{ width: 148 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className={`status-${p.status}`} data-testid={`row-player-${p.id}`}>
                  <td>
                    <span className={`rank-num ${p.myRank ? 'custom' : 'consensus'}`}>
                      #{p.myRank != null ? p.myRank : p.priorityRank}
                    </span>
                  </td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>
                    {(() => {
                      const fp = p.fpRank, espn = p.espnRank;
                      if (fp != null && espn != null) return Math.round((fp + espn) / 2);
                      if (fp != null) return fp;
                      if (espn != null) return espn;
                      return '—';
                    })()}
                  </td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.fpRank ?? '—'}</td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.espnRank ?? '—'}</td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.yahooRank ?? '—'}</td>
                  <td>
                    <span style={{ fontWeight: 700, fontSize: 13 }} data-testid={`text-name-${p.id}`}>{p.name}</span>
                  </td>
                  <td><PosBadge pos={p.posDisplay} /></td>
                  <td style={{ color: 'var(--joyt-text-mid)', fontSize: 12 }}>{p.team}</td>
                  <td>
                    <EditableRank value={p.myRank} playerId={p.id}
                      field="myRank" color="amber" onSave={updateLocal} />
                  </td>
                  <td>
                    <EditableRank value={p.roundOverride} playerId={p.id}
                      field="roundOverride" color="amber" onSave={updateLocal} />
                  </td>
                  <td>
                    <EditableRank value={p.myPosRank} playerId={p.id}
                      field="myPosRank" color="pink" onSave={updateLocal} />
                  </td>
                  <td>
                    <TagSelector tags={p.tagsArray ?? []} playerId={p.id} onSave={updateLocal} />
                  </td>
                  <td><StatusPill status={p.status} /></td>
                  <td>
                    <ActionBtns player={p} onUpdate={updateLocal} />
                  </td>
                </tr>
              ))}
              {players.length === 0 && (
                <tr>
                  <td colSpan={14} style={{ textAlign: 'center', padding: 40, color: 'var(--joyt-text-light)' }}>
                    No players match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{
        padding: '6px 14px', background: 'var(--joyt-card)', borderTop: '1px solid var(--joyt-border)',
        fontSize: 11, color: 'var(--joyt-text-light)',
      }}
      data-testid="text-player-count">
        Showing {players.length} players
      </div>
    </div>
  );
}
