import { api } from '../lib/api.js';

// ── Position badge ────────────────────────────────────────────────────────
const POS_STYLE = {
  OF:   { color:'var(--pos-of)',   bg:'var(--pos-of-bg)'   },
  SP:   { color:'var(--pos-sp)',   bg:'var(--pos-sp-bg)'   },
  RP:   { color:'var(--pos-rp)',   bg:'var(--pos-rp-bg)'   },
  C:    { color:'var(--pos-c)',    bg:'var(--pos-c-bg)'    },
  '1B': { color:'var(--pos-1b)',   bg:'var(--pos-1b-bg)'   },
  '2B': { color:'var(--pos-2b)',   bg:'var(--pos-2b-bg)'   },
  '3B': { color:'var(--pos-3b)',   bg:'var(--pos-3b-bg)'   },
  SS:   { color:'var(--pos-ss)',   bg:'var(--pos-ss-bg)'   },
  DH:   { color:'var(--pos-dh)',   bg:'var(--pos-dh-bg)'   },
  Util: { color:'var(--pos-util)', bg:'var(--pos-util-bg)' },
  P:    { color:'var(--pos-sp)',   bg:'var(--pos-sp-bg)'   },
};

export function PosBadge({ pos, style }) {
  const s = POS_STYLE[pos] ?? POS_STYLE['Util'];
  return (
    <span className="pos-badge"
      style={{ color: s.color, background: s.bg, ...style }}>
      {pos}
    </span>
  );
}

// ── Tag pill ──────────────────────────────────────────────────────────────
const TAG_STYLE = {
  sleeper: { color:'var(--tag-sleeper)', bg:'var(--tag-sleeper-bg)' },
  target:  { color:'var(--tag-target)',  bg:'var(--tag-target-bg)'  },
  watch:   { color:'var(--tag-watch)',   bg:'var(--tag-watch-bg)'   },
  injured: { color:'var(--tag-injured)', bg:'var(--tag-injured-bg)' },
  skip:    { color:'var(--tag-skip)',    bg:'var(--tag-skip-bg)'    },
};

export function TagPill({ tag }) {
  const s = TAG_STYLE[tag] ?? { color:'var(--text-mid)', bg:'var(--surface)' };
  return (
    <span className="tag-pill" style={{ color: s.color, background: s.bg }}>
      {tag}
    </span>
  );
}

// ── Action buttons (Mine / Out / Reset) ───────────────────────────────────
export function ActionBtns({ player, onUpdate, size = 'sm' }) {
  const pad = size === 'sm' ? '3px 8px' : '5px 12px';
  const fs  = size === 'sm' ? '10px' : '12px';

  async function handleMine() {
    const updated = await api.patchPlayer(player.id, { status: 'mine' });
    onUpdate?.(updated);
  }
  async function handleOut() {
    const updated = await api.patchPlayer(player.id, { status: 'drafted' });
    onUpdate?.(updated);
  }
  async function handleReset() {
    const updated = await api.resetPlayer(player.id);
    onUpdate?.(updated);
  }

  const btnStyle = { padding: pad, fontSize: fs };

  if (player.status === 'mine' || player.status === 'drafted') {
    return (
      <button className="btn btn-reset" style={btnStyle} onClick={handleReset}>
        ↺ Reset
      </button>
    );
  }
  return (
    <span style={{ display:'flex', gap:4 }}>
      <button className="btn btn-mine" style={btnStyle} onClick={handleMine}>Mine</button>
      <button className="btn btn-out"  style={btnStyle} onClick={handleOut}>Out</button>
      <button className="btn btn-reset" style={btnStyle} onClick={handleReset}>↺</button>
    </span>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────
export function Card({ accent, title, children, style, bodyStyle }) {
  return (
    <div className="card" style={style}>
      {title && (
        <div className="card-header">
          <span className="dot" style={{ background: accent }} />
          <h3>{title}</h3>
        </div>
      )}
      <div style={{ padding:'0', ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────
export function StatusPill({ status }) {
  const map = {
    available: { label:'Available', color:'var(--green)',  bg:'var(--green-light)' },
    mine:      { label:'My Pick',   color:'var(--blue)',   bg:'var(--blue-light)'  },
    drafted:   { label:'Drafted',   color:'var(--red)',    bg:'var(--red-light)'   },
  };
  const s = map[status] ?? map.available;
  return (
    <span className="status-pill" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

// ── Inline editable number cell ───────────────────────────────────────────
export function EditableRank({ value, playerId, field, color = 'amber', onSave }) {
  async function handleBlur(e) {
    const v = parseInt(e.target.value);
    const val = isNaN(v) ? null : v;
    const updated = await api.patchPlayer(playerId, { [field]: val });
    onSave?.(updated);
  }
  return (
    <input
      className={`editable-cell ${color}`}
      defaultValue={value ?? ''}
      placeholder="—"
      type="number"
      min="1"
      style={{ width: 54 }}
      onBlur={handleBlur}
      onClick={e => e.stopPropagation()}
    />
  );
}

// ── Tag selector (multi-select checkboxes) ────────────────────────────────
const ALL_TAGS = ['sleeper','target','watch','injured','skip'];

export function TagSelector({ tags = [], playerId, onSave }) {
  async function toggle(tag) {
    const current = tags.includes(tag)
      ? tags.filter(t => t !== tag)
      : [...tags, tag];
    const updated = await api.patchPlayer(playerId, { tags: current });
    onSave?.(updated);
  }
  return (
    <span style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
      {ALL_TAGS.map(tag => {
        const active = tags.includes(tag);
        const s = TAG_STYLE[tag] ?? {};
        return (
          <button key={tag}
            className="tag-pill"
            onClick={() => toggle(tag)}
            style={{
              color:      active ? s.color : 'var(--text-light)',
              background: active ? s.bg    : 'var(--surface)',
              border:'none', cursor:'pointer',
              opacity: active ? 1 : 0.6,
            }}>
            {tag}
          </button>
        );
      })}
    </span>
  );
}
