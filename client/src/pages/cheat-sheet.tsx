import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/game-ui';

type CheatSheetContent = {
  strategy: string;
  avoid: string;
  sleepers: string;
  scratchpad: string;
};

const sections = [
  { key: 'strategy', title: 'Draft Strategy',   accent: 'var(--joyt-blue)',   placeholder: 'Add your draft strategy notes…' },
  { key: 'avoid',    title: 'Avoid / Red Flags', accent: 'var(--joyt-red)',    placeholder: 'Players to avoid, injury concerns…' },
  { key: 'sleepers', title: 'Sleeper Targets',   accent: 'var(--joyt-purple)', placeholder: 'Late-round value plays…' },
] as const;

export default function CheatSheet() {
  const [content, setContent] = useState<CheatSheetContent>({
    strategy: '', avoid: '', sleepers: '', scratchpad: '',
  });

  useEffect(() => {
    api.getCheatSheet().then((data: Record<string, string>) => {
      setContent({
        strategy:   data.strategy   ?? '',
        avoid:      data.avoid      ?? '',
        sleepers:   data.sleepers   ?? '',
        scratchpad: data.scratchpad ?? '',
      });
    });
  }, []);

  async function save(section: string, value: string) {
    setContent((c) => ({ ...c, [section]: value }));
    await api.patchCheatSheet(section, value);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        background: 'var(--joyt-pink-light)', padding: '8px 16px',
        fontSize: 12, color: 'var(--joyt-pink)', fontWeight: 500, flexShrink: 0,
      }}>
        Your draft notes — type in any section. Changes auto-save and sync to your partner in real time.
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, padding: 10, overflow: 'hidden' }}>
        {sections.map(({ key, title, accent, placeholder }) => (
          <Card key={key} accent={accent} title={title}
            style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
            bodyStyle={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            <textarea
              className="notes-area"
              style={{ flex: 1, margin: 10, resize: 'none', minHeight: 0, width: 'calc(100% - 20px)', overflowY: 'auto' }}
              placeholder={placeholder}
              value={content[key as keyof CheatSheetContent]}
              onChange={(e) => save(key, e.target.value)}
              data-testid={`textarea-${key}`}
            />
          </Card>
        ))}
      </div>

      {/* Scratch pad */}
      <div style={{
        background: 'var(--joyt-header)', padding: '10px 16px',
        display: 'flex', gap: 12, alignItems: 'flex-start', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#5C6370', whiteSpace: 'nowrap', paddingTop: 3 }}>
          SCRATCH PAD:
        </span>
        <textarea
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#9AA3AF', fontSize: 12, fontFamily: 'var(--font-sans)', resize: 'none', height: 36,
          }}
          placeholder="Live draft notes — anything goes…"
          value={content.scratchpad}
          onChange={(e) => save('scratchpad', e.target.value)}
          data-testid="textarea-scratchpad"
        />
      </div>
    </div>
  );
}
