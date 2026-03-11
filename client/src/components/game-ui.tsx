import { api } from '@/lib/api';

// ── Position badge ─────────────────────────────────────────────────────────
const POS_STYLE: Record<string, { color: string; bg: string }> = {
  OF:   { color: 'var(--pos-of)',   bg: 'var(--pos-of-bg)'   },
  SP:   { color: 'var(--pos-sp)',   bg: 'var(--pos-sp-bg)'   },
  RP:   { color: 'var(--pos-rp)',   bg: 'var(--pos-rp-bg)'   },
  C:    { color: 'var(--pos-c)',    bg: 'var(--pos-c-bg)'    },
  '1B': { color: 'var(--pos-1b)',   bg: 'var(--pos-1b-bg)'   },
  '2B': { color: 'var(--pos-2b)',   bg: 'var(--pos-2b-bg)'   },
  '3B': { color: 'var(--pos-3b)',   bg: 'var(--pos-3b-bg)'   },
  SS:   { color: 'var(--pos-ss)',   bg: 'var(--pos-ss-bg)'   },
  DH:   { color: 'var(--pos-dh)',   bg: 'var(--pos-dh-bg)'   },
  Util: { color: 'var(--pos-util)', bg: 'var(--pos-util-bg)' },
  P:    { color: 'var(--pos-sp)',   bg: 'var(--pos-sp-bg)'   },
  BN:   { color: 'var(--pos-util)', bg: 'var(--pos-util-bg)' },
};

export function PosBadge({ pos, style }: { pos: string; style?: React.CSSProperties }) {
  const s = POS_STYLE[pos] ?? POS_STYLE['Util'];
  return (
    <span className="pos-badge" style={{ color: s.color, background: s.bg, ...style }}>
      {pos}
    </span>
  );
}

// ── Tag pill ───────────────────────────────────────────────────────────────
const TAG_STYLE: Record<string, { color: string; bg: string }> = {
  sleeper: { color: 'var(--tag-sleeper)', bg: 'var(--tag-sleeper-bg)' },
  target:  { color: 'var(--tag-target)',  bg: 'var(--tag-target-bg)'  },
  watch:   { color: 'var(--tag-watch)',   bg: 'var(--tag-watch-bg)'   },
  injured: { color: 'var(--tag-injured)', bg: 'var(--tag-injured-bg)' },
  skip:    { color: 'var(--tag-skip)',    bg: 'var(--tag-skip-bg)'    },
};

export function TagPill({ tag }: { tag: string }) {
  const s = TAG_STYLE[tag] ?? { color: 'var(--joyt-text-mid)', bg: 'var(--joyt-surface)' };
  return (
    <span className="tag-pill" style={{ color: s.color, background: s.bg }}>
      {tag}
    </span>
  );
}

// ── Action buttons (Mine / Out / Reset) ───────────────────────────────────
interface ActionBtnsProps {
  player: any;
  onUpdate?: (updated: any) => void;
  size?: 'sm' | 'md';
}

export function ActionBtns({ player, onUpdate, size = 'sm' }: ActionBtnsProps) {
  const pad  = size === 'sm' ? '3px 8px' : '5px 12px';
  const fs   = size === 'sm' ? '10px' : '12px';
  const btnStyle = { padding: pad, fontSize: fs };

  async function handleMine() {
    const updated = await api.patchPlayer(player.id, { status: 'mine' });
    onUpdate?.(updated);
  }
  async function handleOut() {
    const updated = await api.patchPlayer(player.id, { status: 'drafted' });
    onUpdate?.(updated);
  }
  async function handleAvailable() {
    const updated = await api.patchPlayer(player.id, { status: 'available' });
    onUpdate?.(updated);
  }
  async function handleReset() {
    const updated = await api.resetPlayer(player.id);
    onUpdate?.(updated);
  }

  if (player.status === 'mine' || player.status === 'drafted') {
    return (
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="btn btn-reset" style={btnStyle} onClick={handleAvailable}
          title="Mark available (keeps custom ranks & tags)"
          data-testid={`btn-available-${player.id}`}>
          ↺ Available
        </button>
        <button className="btn" style={{ ...btnStyle, background: 'var(--joyt-surface)', color: 'var(--joyt-text-light)', border: '1px solid var(--joyt-border)' }}
          onClick={handleReset}
          title="Full reset — clears all custom data"
          data-testid={`btn-reset-${player.id}`}>
          Reset All
        </button>
      </span>
    );
  }
  return (
    <span style={{ display: 'flex', gap: 4 }}>
      <button className="btn btn-mine" style={btnStyle} onClick={handleMine}
        data-testid={`btn-mine-${player.id}`}>Mine</button>
      <button className="btn btn-out" style={btnStyle} onClick={handleOut}
        data-testid={`btn-out-${player.id}`}>Out</button>
      <button className="btn btn-reset" style={btnStyle} onClick={handleReset}
        data-testid={`btn-reset-${player.id}`}>↺</button>
    </span>
  );
}

// ── Card wrapper ───────────────────────────────────────────────────────────
interface CardProps {
  accent?: string;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

export function Card({ accent, title, children, style, bodyStyle }: CardProps) {
  return (
    <div className="joyt-card" style={style}>
      {title && (
        <div className="joyt-card-header">
          <span className="dot" style={{ background: accent }} />
          <h3>{title}</h3>
        </div>
      )}
      <div style={{ padding: '0', ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}

// ── Status pill ────────────────────────────────────────────────────────────
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    available: { label: 'Available', color: 'var(--joyt-green)',  bg: 'var(--joyt-green-light)' },
    mine:      { label: 'My Pick',   color: 'var(--joyt-blue)',   bg: 'var(--joyt-blue-light)'  },
    drafted:   { label: 'Drafted',   color: 'var(--joyt-red)',    bg: 'var(--joyt-red-light)'   },
  };
  const s = map[status] ?? map.available;
  return (
    <span className="status-pill" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

// ── Inline editable number cell ────────────────────────────────────────────
interface EditableRankProps {
  value: number | null | undefined;
  playerId: number;
  field: string;
  color?: 'amber' | 'pink';
  onSave?: (updated: any) => void;
}

export function EditableRank({ value, playerId, field, color = 'amber', onSave }: EditableRankProps) {
  async function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
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
      onClick={(e) => e.stopPropagation()}
      data-testid={`editable-${field}-${playerId}`}
    />
  );
}

// ── Tag selector (multi-select clickable pills) ────────────────────────────
const ALL_TAGS = ['sleeper', 'target', 'watch', 'injured', 'skip'];

interface TagSelectorProps {
  tags: string[];
  playerId: number;
  onSave?: (updated: any) => void;
}

export function TagSelector({ tags = [], playerId, onSave }: TagSelectorProps) {
  async function toggle(tag: string) {
    const current = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : [...tags, tag];
    const updated = await api.patchPlayer(playerId, { tags: current.join(',') });
    onSave?.(updated);
  }
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {ALL_TAGS.map((tag) => {
        const active = tags.includes(tag);
        const s = TAG_STYLE[tag] ?? {};
        return (
          <button
            key={tag}
            className="tag-pill"
            onClick={() => toggle(tag)}
            data-testid={`tag-${tag}-${playerId}`}
            style={{
              color:      active ? s.color : 'var(--joyt-text-light)',
              background: active ? s.bg    : 'var(--joyt-surface)',
              border: 'none',
              cursor: 'pointer',
              opacity: active ? 1 : 0.6,
            }}
          >
            {tag}
          </button>
        );
      })}
    </span>
  );
}
