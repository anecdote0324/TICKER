// 상태 표시줄: 연결 상태(한국투자증권 실시간 구독 수, Binance, 환율 갱신 주기. 멈춘 소스는 ⚠), 연동 그룹,
// 자동완성 도움 수준 빠른 전환, 명령 팔레트와 도움말 안내(02).

import { useState } from 'react';
import { ASSIST_LABEL, SOURCE_LABEL, bindingsFor, displayName, formatBinding, formatInterval, type AssistLevel, type ShortcutId, type SourceStatus } from '@bt/shared';
import { isMac } from '../api';
import { focusRegistry } from './focus';
import { feedStatus } from '../stores/feed';
import { getInstrument, indexState } from '../stores/instruments';
import { activePanelId, LINK_COLORS, panels, type LinkColor } from '../stores/panels';
import { settings, updateSettings } from '../stores/settings';
import { useStore } from '../stores/store';
import { openHelp, openSettings, ui } from '../stores/ui';

function SourceItem({ s }: { s: SourceStatus }) {
  const ok = s.state === 'connected';
  const name = s.source === 'KIS' ? '한국투자증권' : s.source === 'BINANCE' ? 'Binance' : s.source === 'ECB' ? '환율' : '데모';
  let extra = '';
  if (s.source === 'KIS' && s.wsLimit) extra = ` 실시간 ${s.wsUsed ?? 0}/${s.wsLimit}`;
  if (s.source === 'ECB' && s.intervalMs) extra = ` ${formatInterval(s.intervalMs)}마다 확인`;
  return (
    <span className="src" title={`${SOURCE_LABEL[s.source]}: ${s.message ?? s.state}`}>
      {!ok && s.source !== 'DEMO' && <span className="warn">⚠</span>}
      <span className={`dot ${ok ? 'ok' : 'bad'} ${s.source === 'DEMO' ? 'demo' : ''}`} />
      <span className={ok ? '' : 'warn'}>
        {name}
        {extra}
      </span>
    </span>
  );
}

/** 연동 그룹: 색마다 지금 함께 보고 있는 종목(02 상태 표시줄). 누르면 그 그룹의 첫 패널로 */
function LinkGroups() {
  const all = useStore(panels);
  const list = Object.values(all).sort((a, b) => a.num - b.num);
  return (
    <>
      {(Object.keys(LINK_COLORS) as LinkColor[]).map((c) => {
        const ps = list.filter((p) => p.link === c);
        if (ps.length === 0) return null;
        const inst = getInstrument(ps.find((p) => p.securityId)?.securityId);
        const code = inst ? (inst.market === 'US' ? `${inst.code} US` : inst.code) : '—';
        return (
          <button
            key={c}
            className="link-group"
            title={`연동 그룹 ${LINK_COLORS[c].label}: 패널 ${ps.map((p) => p.num).join('·')}${inst ? ` · ${displayName(inst)}` : ''}`}
            onClick={() => {
              activePanelId.set(ps[0].id);
              focusRegistry.command.get(ps[0].id)?.('');
            }}
          >
            <i style={{ background: LINK_COLORS[c].color }} />
            <span className="mono">{code}</span>
          </button>
        );
      })}
    </>
  );
}

/** 종목 목록 일부를 설치 파일에 넣은 사본으로 대신했을 때 설명(05 §6.1) */
function snapshotNote(sources: Array<{ name: string; snapshot?: boolean; error?: string }>): string | undefined {
  const s = sources.filter((x) => x.snapshot);
  if (s.length === 0) return undefined;
  return `받지 못한 종목 목록(${s.map((x) => x.name).join(', ')})을 앱에 넣은 사본으로 대신했어요. 인터넷이 연결되면 다음 실행 때 새로 받아요`;
}

function keyLabel(id: ShortcutId, keys: Parameters<typeof bindingsFor>[1]) {
  const b = bindingsFor(id, keys, isMac)[0];
  return b ? formatBinding(b, isMac) : '';
}

export function StatusBar() {
  const fs = useStore(feedStatus);
  const idx = useStore(indexState);
  const assist = useStore(settings, (s) => s.commandLine.assist);
  const keys = useStore(settings, (s) => s.keys);
  const [menu, setMenu] = useState(false);
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
      <span className="label" title={snapshotNote(idx.sources)}>
        {idx.loading ? '종목 목록 불러오는 중…' : `종목 ${idx.count.toLocaleString()}개`}
        {!idx.loading && idx.sources.some((s) => s.snapshot) && ` · 사본 ${idx.sources.find((s) => s.snapshot)?.asOf ?? ''}`}
      </span>
      <span className="spacer" />
      <LinkGroups />
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
      {keyLabel('palette', keys) && <span>명령 팔레트 {keyLabel('palette', keys)}</span>}
      {keyLabel('settings', keys) && <span>설정 {keyLabel('settings', keys)}</span>}
      <button onClick={() => openHelp('help')}>도움말 ?</button>
    </footer>
  );
}
