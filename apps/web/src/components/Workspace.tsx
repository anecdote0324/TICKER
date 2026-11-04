// 화면 탭 하나의 패널 배치(dockview). 패널마다 1줄(번호·커맨드 라인·연동 그룹·떼어내기·최대화·닫기)과
// 2줄(기능 코드·제목·신선도 배지·도구), 본문을 그려요(02 패널 구조).

import { useEffect, useRef, useState } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { FUNCTIONS } from '@bt/shared';
import { Comp } from '../widgets/Comp';
import { Cryp } from '../widgets/Cryp';
import { Des } from '../widgets/Des';
import { Fxc } from '../widgets/Fxc';
import { Hmap } from '../widgets/Hmap';
import { Imap } from '../widgets/Imap';
import { Grid } from '../widgets/Grid';
import { WorldMap } from '../widgets/WorldMap';
import { Alrt } from '../widgets/Alrt';
import { Port } from '../widgets/Port';
import { Eco } from '../widgets/Eco';
import { Fa } from '../widgets/Fa';
import { Gc } from '../widgets/Gc';
import { Last } from '../widgets/Last';
import { Menu } from '../widgets/Menu';
import { Search } from '../widgets/Search';
import { Mon } from '../widgets/Mon';
import { News } from '../widgets/News';
import { Most } from '../widgets/Most';
import { PriceChart } from '../widgets/PriceChart';
import { Wei } from '../widgets/Wei';
import { TitleBar } from '../widgets/common';
import type { Execution } from '@bt/command';
import { activePanelId, applyExecution, LINK_COLORS, nextPanelNumber, panels, removePanel, upsertPanel, type LinkColor, type PanelState } from '../stores/panels';
import { preparePopoutDocument, releasePopoutDocument } from '../popout';
import { useStore } from '../stores/store';
import { CommandLine } from './CommandLine';
import { focusRegistry } from './focus';

export const dockApis = new Map<string, DockviewApi>();

const theme = { name: 'bt', className: 'dockview-theme-bt' };

function PanelView(props: IDockviewPanelProps<{ panelId: string }>) {
  const id = props.params.panelId;
  const p = useStore(panels, (all) => all[id]);
  const [bodyFocus, setBodyFocus] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusRegistry.body.set(id, () => {
      bodyRef.current?.focus();
    });
    return () => {
      focusRegistry.body.delete(id);
    };
  }, [id]);
  if (!p) return <div className="panel" />;
  return (
    <div
      ref={bodyRef}
      className={`panel ${bodyFocus ? 'body-focus' : ''}`}
      tabIndex={-1}
      onFocus={(e) => {
        activePanelId.set(id);
        if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('.cmd')) setBodyFocus(true);
      }}
      onBlur={() => setBodyFocus(false)}
      onMouseDown={() => activePanelId.set(id)}
      onKeyDown={(e) => {
        // 본문에서 영문·숫자 키를 치면 커맨드 라인으로 돌아가 그 글자부터 입력돼요(05 §10.1)
        if (!bodyFocus) return;
        // Mod+L(활성 패널의 커맨드 라인으로)은 앱 단축키가 처리해요
        if (e.key === 'Escape') {
          e.preventDefault();
          focusRegistry.command.get(id)?.('');
        } else if (/^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest('input')) {
          e.preventDefault();
          focusRegistry.command.get(id)?.(e.key);
        }
      }}
    >
      <PanelContent p={p} bodyFocus={bodyFocus} />
    </div>
  );
}

function PanelContent({ p, bodyFocus }: { p: PanelState; bodyFocus: boolean }) {
  switch (p.fn) {
    case 'MON':
      return <Mon panel={p} bodyFocus={bodyFocus} />;
    case 'GP':
      return <PriceChart panel={p} intraday={false} />;
    case 'GIP':
      return <PriceChart panel={p} intraday />;
    case 'WEI':
      return <Wei panel={p} />;
    case 'FXC':
      return <Fxc panel={p} />;
    case 'CRYP':
      return <Cryp panel={p} />;
    case 'DES':
      return <Des panel={p} />;
    case 'MOST':
      return <Most panel={p} />;
    case 'COMP':
      return <Comp panel={p} />;
    case 'N':
      return <News panel={p} />;
    case 'HMAP':
      return <Hmap panel={p} />;
    case 'IMAP':
      return <Imap panel={p} />;
    case 'LAST':
      return <Last panel={p} />;
    case 'GC':
      return <Gc panel={p} />;
    case 'FA':
      return <Fa panel={p} />;
    case 'ECO':
      return <Eco panel={p} />;
    case 'PORT':
      return <Port panel={p} />;
    case 'ALRT':
      return <Alrt panel={p} />;
    case 'GRID':
      return <Grid panel={p} />;
    case 'MAP':
      return <WorldMap panel={p} />;
    case 'MENU':
      return <Menu panel={p} />;
    case 'SEARCH':
      return <Search panel={p} />;
    default: {
      const fn = p.fn ? FUNCTIONS.find((f) => f.code === p.fn) : undefined;
      return (
        <>
          <TitleBar fn={p.fn ?? '—'} name={fn?.nameKo ?? '빈 패널'} />
          <div className="empty-body">
            <div>명령을 입력하세요 · 예: 005930 GP ⏎</div>
            <div className="label">Tab 자동완성 · ⏎ 실행 · ? 도움말</div>
          </div>
        </>
      );
    }
  }
}

function NumTab(props: IDockviewPanelHeaderProps<{ panelId: string }>) {
  const p = useStore(panels, (all) => all[props.params.panelId]);
  const active = useStore(activePanelId) === props.params.panelId;
  return (
    <div className={`pnum ${active ? 'active' : ''}`} title="끌어서 옮기기">
      {p?.num ?? ''}
    </div>
  );
}

function HeaderCommand(props: IDockviewHeaderActionsProps) {
  const panel = props.activePanel;
  const id = (panel?.params as { panelId?: string } | undefined)?.panelId;
  if (!id) return null;
  return <PanelCommand id={id} />;
}

function PanelCommand({ id }: { id: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100%', padding: '0 6px', minWidth: 0 }}>
      <CommandLineWithRegistry id={id} />
    </div>
  );
}

function CommandLineWithRegistry({ id }: { id: string }) {
  const [focusKey, setFocusKey] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusRegistry.command.set(id, (initial: string) => {
      const inp = wrapRef.current?.querySelector('input');
      if (!inp) return;
      // 다른 창(떼어낸 창)의 패널이면 그 창을 앞으로 가져와요(Ctrl+Tab, Mod+숫자)
      if (!inp.ownerDocument.hasFocus()) inp.ownerDocument.defaultView?.focus();
      inp.focus();
      if (initial) {
        inp.ownerDocument.execCommand('insertText', false, initial);
      }
      setFocusKey((k) => k + 1);
    });
    return () => {
      focusRegistry.command.delete(id);
    };
  }, [id]);
  void focusKey;
  return (
    <div ref={wrapRef} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex' }} onFocus={() => activePanelId.set(id)}>
      <CommandLine panelId={id} onEscapeEmpty={() => focusRegistry.body.get(id)?.()} />
    </div>
  );
}

function HeaderActions(props: IDockviewHeaderActionsProps) {
  const panel = props.activePanel;
  const id = (panel?.params as { panelId?: string } | undefined)?.panelId;
  const p = useStore(panels, (all) => (id ? all[id] : undefined));
  if (!panel || !p) return null;
  const order: Array<LinkColor | null> = ['blue', 'purple', 'teal', null];
  const nextLink = order[(order.indexOf(p.link) + 1) % order.length];
  const maximized = props.containerApi.hasMaximizedGroup();
  const inPopout = props.group.api.location.type === 'popout';
  return (
    <div className="pactions">
      <button
        className="link-sq"
        style={p.link ? { background: LINK_COLORS[p.link].color, borderColor: LINK_COLORS[p.link].color } : undefined}
        title={`연동 그룹: ${p.link ? LINK_COLORS[p.link].label : '없음'} (눌러서 바꾸기)`}
        aria-label={`연동 그룹 ${p.link ? LINK_COLORS[p.link].label : '없음'}`}
        onClick={() => upsertPanel({ ...p, link: nextLink })}
      />
      {!inPopout && (
        <button
          aria-label="새 창으로 떼어내기"
          title="새 창으로 떼어내기(다른 모니터로 옮길 수 있어요)"
          onClick={() => {
            void props.containerApi.addPopoutGroup(props.group, { popoutUrl: 'popout.html' });
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}>
            <path d="M7 1.5h3.5V5M10.5 1.5L6 6M5 2.5H1.5v8h8V7" />
          </svg>
        </button>
      )}
      <button
        aria-label={maximized ? '원래 크기로' : '패널 최대화'}
        title={maximized ? '원래 크기로' : '최대화'}
        onClick={() => (maximized ? props.containerApi.exitMaximizedGroup() : props.containerApi.maximizeGroup(panel))}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}>
          <path d="M1.5 1.5h9v9h-9z" />
        </svg>
      </button>
      <button aria-label="패널 닫기" title="닫기" onClick={() => panel.api.close()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}>
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}

function Watermark(props: IWatermarkPanelProps) {
  return (
    <div className="empty-body">
      <div>빈 화면이에요</div>
      <button className="btn" onClick={() => addPanel(props.containerApi)}>
        패널 추가
      </button>
    </div>
  );
}

export function newPanelState(fn?: string, securityId?: string, link: LinkColor | null = null, extra: Partial<PanelState> = {}): PanelState {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { id, num: nextPanelNumber(), fn, securityId, link, back: [], fwd: [], ...extra };
}

/**
 * Shift+Enter·Mod+Enter(05 §10.2, v0.2): 명령을 지금 패널 대신 옆 새 패널(right)이나 새로 떼어낸 창(window)에서 실행해요.
 * 새 패널은 연동 그룹 없이 만들어요(원래 패널의 종목이 함께 바뀌지 않게)
 */
export function openInNewPanel(fromPanelId: string, exec: Execution, where: 'right' | 'window'): boolean {
  for (const api of dockApis.values()) {
    const from = api.getPanel(fromPanelId);
    if (!from) continue;
    const s = newPanelState();
    const created = addPanel(api, s, { referencePanel: from, direction: 'right' });
    applyExecution(s.id, exec);
    if (where === 'window') void api.addPopoutGroup(created.group, { popoutUrl: 'popout.html' });
    return true;
  }
  return false;
}

export function addPanel(api: DockviewApi, state?: PanelState, position?: Parameters<DockviewApi['addPanel']>[0]['position']) {
  const s = state ?? newPanelState();
  upsertPanel(s);
  const active = api.activePanel;
  const panel = api.addPanel({
    id: s.id,
    component: 'panel',
    tabComponent: 'num',
    params: { panelId: s.id },
    title: String(s.num),
    position: position ?? (active ? { referencePanel: active, direction: 'right' } : undefined),
  });
  activePanelId.set(s.id);
  setTimeout(() => focusRegistry.command.get(s.id)?.(''), 30);
  return panel;
}

/**
 * 기본 배치(02, v0.2): 1 MON · 2 GP · 3 WEI / 4 N · 5 HMAP · 6 FXC · 7 CRYP. 처음 켤 때(저장된 배치가 없을 때)만 써요.
 * 4번 N과 5번 HMAP은 연동 그룹 없이 전체 뉴스와 코스피 업종을 보여 줘요
 */
export function buildDefaultLayout(api: DockviewApi) {
  const add = (s: PanelState, position?: Parameters<DockviewApi['addPanel']>[0]['position']) => {
    upsertPanel(s);
    return api.addPanel({ id: s.id, component: 'panel', tabComponent: 'num', params: { panelId: s.id }, title: String(s.num), position });
  };
  const mk = (num: number, fn: string, securityId?: string, link: LinkColor | null = null, extra: Partial<PanelState> = {}): PanelState => ({
    id: `p${num}`,
    num,
    fn,
    securityId,
    link,
    back: [],
    fwd: [],
    ...extra,
  });
  const p1 = add(mk(1, 'MON', undefined, 'blue', { watchGroups: ['kr', 'us', 'crypto', 'fx'] }));
  const p2 = add(mk(2, 'GP', 'EQ:KS:005930', 'blue'), { referencePanel: p1, direction: 'right' });
  const p3 = add(mk(3, 'WEI'), { referencePanel: p2, direction: 'right' });
  const p4 = add(mk(4, 'N'), { referencePanel: p1, direction: 'below' });
  const p5 = add(mk(5, 'HMAP', undefined, null, { args: ['KOSPI'] }), { referencePanel: p2, direction: 'below' });
  const p6 = add(mk(6, 'FXC'), { referencePanel: p3, direction: 'below' });
  const p7 = add(mk(7, 'CRYP'), { referencePanel: p6, direction: 'below' });
  const W = api.width || 1920;
  const H = api.height || 1000;
  p1.group.api.setSize({ width: Math.round(W * 0.2) });
  p3.group.api.setSize({ width: Math.round(W * 0.33) });
  p1.group.api.setSize({ height: Math.round(H * 0.6) });
  p2.group.api.setSize({ height: Math.round(H * 0.6) });
  p3.group.api.setSize({ height: Math.round(H * 0.36) });
  p6.group.api.setSize({ height: Math.round(H * 0.28) });
  void p4;
  void p5;
  void p7;
  p2.api.setActive();
  activePanelId.set('p2');
}

/**
 * Deep Dive 기본 배치(v0.3, 02 모니터 2): 한 종목을 깊게 보는 화면. 모두 보라 연동 그룹이라 Market Pulse(파랑)와 따로 움직여요.
 * 왼쪽 GP(위)·GIP(아래), 오른쪽 DES·FA·N
 */
export function buildDeepDiveLayout(api: DockviewApi) {
  const add = (s: PanelState, position?: Parameters<DockviewApi['addPanel']>[0]['position']) => {
    upsertPanel(s);
    return api.addPanel({ id: s.id, component: 'panel', tabComponent: 'num', params: { panelId: s.id }, title: String(s.num), position });
  };
  const mk = (num: number, fn: string): PanelState => ({ id: `p${num}`, num, fn, securityId: 'EQ:KS:005930', link: 'purple', back: [], fwd: [] });
  const gp = add(mk(8, 'GP'));
  const des = add(mk(9, 'DES'), { referencePanel: gp, direction: 'right' });
  add(mk(10, 'GIP'), { referencePanel: gp, direction: 'below' });
  const fa = add(mk(11, 'FA'), { referencePanel: des, direction: 'below' });
  add(mk(12, 'N'), { referencePanel: fa, direction: 'below' });
  const W = api.width || 1920;
  const H = api.height || 1000;
  gp.group.api.setSize({ width: Math.round(W * 0.58), height: Math.round(H * 0.62) });
  des.group.api.setSize({ height: Math.round(H * 0.34) });
  // 활성 패널은 건드리지 않아요(숨은 Deep Dive가 Market Pulse의 활성 패널을 가져가 커맨드 라인이 그쪽으로 갔어요)
}

export interface ScreenLayout {
  dock: ReturnType<DockviewApi['toJSON']> | null;
}

export function Workspace({ screenId, initial, onChange, visible }: { screenId: string; initial: ScreenLayout | null; onChange: (l: ScreenLayout) => void; visible: boolean }) {
  const apiRef = useRef<DockviewApi | null>(null);
  // 화면을 다른 창으로 옮기거나 워크스페이스를 불러오면 이 배치는 사라지지만 패널은 그대로예요
  const disposed = useRef(false);
  const onReady = (e: DockviewReadyEvent) => {
    const api = e.api;
    apiRef.current = api;
    dockApis.set(screenId, api);
    let restored = false;
    if (initial?.dock) {
      try {
        api.fromJSON(initial.dock);
        restored = api.panels.length > 0;
      } catch {
        restored = false;
      }
    }
    if (!restored && screenId === 'main') buildDefaultLayout(api);
    if (!restored && screenId === 'deep') buildDeepDiveLayout(api);
    api.onDidLayoutChange(() => onChange({ dock: api.toJSON() }));
    // 처음 만든 배치도 바로 저장해요(배치 변경 이벤트가 없어도)
    onChange({ dock: api.toJSON() });
    api.onDidRemovePanel((panel) => {
      const id = (panel.params as { panelId?: string } | undefined)?.panelId;
      // 떼어낸 창으로 옮길 때도 제거·추가가 일어나요. 같은 id가 다시 생기지 않을 때만 지워요
      if (id) setTimeout(() => !disposed.current && !api.getPanel(panel.id) && !findPanelInAll(panel.id) && removePanel(id), 500);
    });
    // 떼어낸 창(복원된 것 포함)에도 스타일·색·단축키를 붙여요(05 §14.3)
    api.onDidAddPopoutGroup((g) => preparePopoutDocument(g.window));
    api.onWillClosePopoutWindow((ev) => {
      try {
        releasePopoutDocument(ev.window.document);
      } catch {
        // 이미 닫힌 창
      }
    });
    api.onDidActivePanelChange((ev) => {
      const id = ((ev as { panel?: { params?: { panelId?: string } } }).panel ?? (ev as unknown as { params?: { panelId?: string } }))?.params?.panelId;
      if (id) activePanelId.set(id);
    });
  };
  // 화면 탭을 닫으면 그 화면의 배치 API도 지워요
  useEffect(
    () => () => {
      disposed.current = true;
      if (dockApis.get(screenId) === apiRef.current) dockApis.delete(screenId);
    },
    [screenId],
  );
  useEffect(() => {
    if (visible && apiRef.current) {
      const api = apiRef.current;
      requestAnimationFrame(() => api.layout(api.width, api.height, true));
    }
  }, [visible]);
  return (
    <div className="workspace" data-screen={screenId} style={visible ? undefined : { display: 'none' }}>
      <DockviewReact
        className="dockview-theme-bt"
        theme={theme}
        onReady={onReady}
        components={{ panel: PanelView }}
        tabComponents={{ num: NumTab }}
        defaultTabComponent={NumTab}
        leftHeaderActionsComponent={HeaderCommand}
        rightHeaderActionsComponent={HeaderActions}
        watermarkComponent={Watermark}
        popoutUrl="popout.html"
      />
    </div>
  );
}

function findPanelInAll(id: string): boolean {
  for (const api of dockApis.values()) if (api.getPanel(id)) return true;
  return false;
}
