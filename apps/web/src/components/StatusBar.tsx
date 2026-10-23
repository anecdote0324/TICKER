// 상태 표시줄: 연결 상태(한국투자증권 실시간 구독 수, Binance, 환율 갱신 주기. 멈춘 소스는 ⚠), 연동 그룹,
// 자동완성 도움 수준 빠른 전환, 명령 팔레트와 도움말 안내(02).

import { useState } from 'react';
import { ASSIST_LABEL, SOURCE_LABEL, formatInterval, type AssistLevel, type SourceStatus } from '@bt/shared';
import { isMac } from '../api';
import { feedStatus } from '../stores/feed';
import { indexState } from '../stores/instruments';
import { settings, updateSettings } from '../stores/settings';
import { useStore } from '../stores/store';
import { openSettings, ui } from '../stores/ui';

function SourceItem({ s }: { s: SourceStatus }) {
  const ok = s.state === 'connected';
  const name = s.source === 'KIS' ? '한국투자증권' : s.source === 'BINANCE' ? 'Binance' : s.source === 'ECB' ? '환율' : '데모';
  let extra = '';
  if (s.source === 'KIS' && s.wsLimit) extra = ` 실시간 ${s.wsUsed ?? 0}/${s.wsLimit}`;
  if (s.source === 'ECB' && s.intervalMs) extra = ` ${formatInterval(s.intervalMs)}마다 확인`;
  return (
    <span className="src" title={`${SOURCE_LABEL[s.source]}: ${s.message ?? s.state}`}>
      {!ok && s.source !== 'DEMO' && <span className="warn">⚠</span>}
      <span className={`dot ${ok ? 'ok' : 'bad'}`} />
      <span className={ok ? '' : 'warn'}>
        {name}
        {extra}
      </span>
    </span>
  );
}

export function StatusBar() {
  const fs = useStore(feedStatus);
  const idx = useStore(indexState);
  const assist = useStore(settings, (s) => s.commandLine.assist);
  const [menu, setMenu] = useState(false);
  const mod = isMac ? '⌘' : 'Ctrl+';
  return (
    <footer className="statusbar">
      {!fs.connected && <span className="warn">⚠ 내장 서버 연결 끊김 · 다시 연결 중</span>}
      {fs.demo && (
        <span className="demo-flag" title="한국투자증권 키를 넣기 전에는 주식·지수가 데모 값이에요" onClick={() => openSettings('data')} style={{ cursor: 'pointer' }}>
          데모 시세
        </span>
      )}
      {fs.sources.map((s) => (
        <SourceItem key={s.source} s={s} />
      ))}
      <span className="label">{idx.loading ? '종목 목록 불러오는 중…' : `종목 ${idx.count.toLocaleString()}개`}</span>
      <span className="spacer" />
      <span style={{ position: 'relative' }}>
        <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
          도움: {ASSIST_LABEL[assist]} ▾
        </button>
        {menu && (
          <div role="menu" style={{ position: 'absolute', bottom: 22, right: 0, background: '#161616', border: '1px solid #333', zIndex: 50 }}>
            {(Object.keys(ASSIST_LABEL) as AssistLevel[]).map((k) => (
              <button
                key={k}
                role="menuitemradio"
                aria-checked={k === assist}
                style={{ display: 'block', width: 90, textAlign: 'left', border: 0, background: k === assist ? '#262626' : 'transparent' }}
                onClick={() => {
                  void updateSettings({ commandLine: { assist: k } });
                  setMenu(false);
                }}
              >
                {k === assist ? '● ' : '  '}
                {ASSIST_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </span>
      <span>명령 팔레트 {mod}K</span>
      <span>설정 {mod},</span>
      <button onClick={() => ui.set((s) => ({ ...s, help: 'help' }))}>도움말 ?</button>
    </footer>
  );
}
