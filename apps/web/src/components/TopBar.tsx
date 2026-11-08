// 맨 위 줄: 로고, 화면 탭(Market Pulse, +), 날짜, 서울·도쿄·런던·뉴욕 시계와 장 상태(02).
// 화면 탭은 새 창으로 떼어낼 수 있어요. 떼어낸 탭을 누르면 그 창을 앞으로 가져와요.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EXCHANGES, SESSION_LABEL, sessionState, zonedParts } from '@bt/shared';
import { useNow } from '../hooks/useNow';

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Screen {
  id: string;
  name: string;
  /** 새 창으로 떼어냈어요(그 창에 패널 배치를 그려요) */
  detached?: boolean;
  /** 떼어낸 창(같은 창에 화면 탭이 여러 개일 수 있어요, v0.2). 없으면 화면 id가 창 id */
  win?: string;
  /** 마지막으로 떼어냈던 창의 위치·크기 */
  bounds?: ScreenBounds;
}

const iconStyle = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 };

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 화면 탭 이름 칸이 가장 좁아졌을 때의 너비(이름은 안 보이고 누를 자리만 남아요) */
const TAB_NAME_MIN = 16;
/** 단추를 숨긴 탭의 가장 좁은 너비 */
const TAB_BARE_MIN = 24;

type TopFit = { clocks: 'none' | 'date' | 'all'; bareTabs: boolean };

/**
 * 맨 위 줄이 좁을 때 무엇부터 줄일지(사용자 결정):
 * ① 화면 탭 이름(이름이 아예 안 보일 때까지, CSS flex-shrink) ② 날짜 ③ 탭의 떼어내기·닫기 단추(오른쪽 클릭 메뉴로 대신)
 * ④ 뒤쪽 시계(뉴욕→런던→도쿄, CSS 줄넘김) ⑤ 서울 시계도 다 안 들어가면 시계 칸을 비워요.
 * 탭과 탭 칸의 가장 좁은 너비는 여기서 정해요(CSS min-content는 줄인 이름이 아니라 전체 이름 너비라서)
 */
function useTopFit(tabCount: number) {
  const ref = useRef<HTMLElement>(null);
  const widths = useRef(new Map<number, number>());
  const iconW = useRef(0);
  const [fit, setFit] = useState<TopFit>({ clocks: 'none', bareTabs: false });
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    const check = () => {
      const kids = [...header.children] as HTMLElement[];
      const tabs = header.querySelector<HTMLElement>('.screen-tabs');
      const clocks = header.querySelector<HTMLElement>('.clocks');
      if (!tabs || !clocks) return;
      // 시계 칸 각 항목의 너비(숨긴 것은 지난번에 잰 값)
      [...clocks.children].forEach((c, i) => {
        const w = (c as HTMLElement).offsetWidth;
        if (w > 0) widths.current.set(i, w);
      });
      const items = clocks.children.length;
      let all = 16 * Math.max(0, items - 1);
      for (let i = 0; i < items; i++) all += widths.current.get(i) ?? 0;
      const noDate = all - (widths.current.get(0) ?? 0) - 16;
      const seoulW = widths.current.get(1) ?? 0;
      // 탭: 단추가 있을 때와 없을 때의 가장 좁은 너비
      let withIcons = 0;
      let bare = 0;
      for (const t of [...tabs.children] as HTMLElement[]) {
        const name = t.querySelector<HTMLElement>('.stab-name');
        if (!name) {
          withIcons += t.offsetWidth;
          bare += t.offsetWidth;
          continue;
        }
        let icons = 0;
        for (const c of [...t.children] as HTMLElement[]) {
          if (c === name) continue;
          const st = getComputedStyle(c);
          const w = c.offsetWidth + (parseFloat(st.marginLeft) || 0) + (parseFloat(st.marginRight) || 0);
          if (w > 0) iconW.current = Math.max(iconW.current, w);
          icons++;
        }
        const min = TAB_NAME_MIN + icons * iconW.current;
        withIcons += min;
        bare += TAB_BARE_MIN;
      }
      const cs = getComputedStyle(header);
      const gap = parseFloat(cs.columnGap) || 0;
      let others = 0;
      for (const k of kids) if (k !== tabs && k !== clocks) others += k.offsetWidth;
      const room = header.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * (kids.length - 1) - others;
      let next: TopFit;
      if (room - withIcons >= all) next = { clocks: 'none', bareTabs: false };
      else if (room - withIcons >= noDate) next = { clocks: 'date', bareTabs: false };
      else if (room - bare >= seoulW) next = { clocks: 'date', bareTabs: true };
      else next = { clocks: 'all', bareTabs: true };
      // 탭마다·탭 칸의 가장 좁은 너비
      const nameMin = next.bareTabs ? TAB_BARE_MIN : TAB_NAME_MIN;
      let tabsMin = 0;
      for (const t of [...tabs.children] as HTMLElement[]) {
        const name = t.querySelector<HTMLElement>('.stab-name');
        if (!name) {
          tabsMin += t.offsetWidth;
          continue;
        }
        const icons = next.bareTabs ? 0 : [...t.children].filter((c) => c !== name).length;
        const min = nameMin + icons * iconW.current;
        if (t.style.minWidth !== `${min}px`) t.style.minWidth = `${min}px`;
        tabsMin += min;
      }
      if (tabs.style.minWidth !== `${tabsMin}px`) tabs.style.minWidth = `${tabsMin}px`;
      // 시계 칸은 들어갈 수 있는 시계만큼은 줄지 않게 해요(그래야 탭이 먼저 줄어요). 날짜를 숨겼으면 서울부터 셉니다
      const avail = room - tabsMin;
      let keep = 0;
      let used = 0;
      for (let i = next.clocks === 'none' ? 0 : 1; i < items; i++) {
        const w = (widths.current.get(i) ?? 0) + (used ? 16 : 0);
        if (used + w > avail) break;
        used += w;
        keep++;
      }
      const clocksMin = next.clocks === 'all' || keep === 0 ? 0 : Math.ceil(used);
      if (clocks.style.minWidth !== `${clocksMin}px`) clocks.style.minWidth = `${clocksMin}px`;
      setFit((f) => (f.clocks === next.clocks && f.bareTabs === next.bareTabs ? f : next));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(header);
    return () => ro.disconnect();
  }, [tabCount]);
  return { ref, ...fit };
}

/** 화면 탭 오른쪽 클릭 메뉴 */
interface TabMenu {
  id: string;
  x: number;
  y: number;
}

export function TopBar(props: {
  screens: Screen[];
  active: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onDetach: (id: string) => void;
  onAttach: (id: string) => void;
  onAddPanel: () => void;
  workspaceMenu?: ReactNode;
}) {
  // 메인 창에는 화면이 하나 이상 남아야 해요. 그래서 메인 창의 마지막 화면은 닫거나 떼어낼 수 없어요
  const detachable = props.screens.filter((s) => !s.detached).length > 1;
  const closable = (s: Screen) => props.screens.length > 1 && (s.detached || detachable);
  const now = useNow(1000);
  const [editing, setEditing] = useState<string | null>(null);
  const seoul = zonedParts(now, 'Asia/Seoul');
  const fit = useTopFit(props.screens.length);
  const [menu, setMenu] = useState<TabMenu | null>(null);
  // 메뉴 밖을 누르거나 Esc면 닫아요
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const menuScreen = menu ? props.screens.find((x) => x.id === menu.id) : undefined;
  return (
    <header className="topbar" ref={fit.ref}>
      <div className="logo">
        <i />
        <b>TICKER</b>
      </div>
      <nav className={`screen-tabs ${fit.bareTabs ? 'bare' : ''}`} aria-label="화면 탭">
        {props.screens.map((s) =>
          editing === s.id ? (
            <input
              key={s.id}
              autoFocus
              defaultValue={s.name}
              onBlur={(e) => {
                props.onRename(s.id, e.target.value.trim() || s.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <div
              key={s.id}
              className={`stab ${s.id === props.active && !s.detached ? 'on' : ''} ${s.detached ? 'detached' : ''}`}
              title={s.detached ? `${s.name} (다른 창에 떼어낸 화면)` : s.name}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: s.id, x: e.clientX, y: e.clientY });
              }}
            >
              <button
                className="stab-name"
                onClick={() => props.onSelect(s.id)}
                onDoubleClick={() => setEditing(s.id)}
              >
                {s.detached && (
                  <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" style={{ ...iconStyle, marginRight: 5 }}>
                    <path d="M7 1.5h3.5V5M10.5 1.5L6 6M5 2.5H1.5v8h8V7" />
                  </svg>
                )}
                {s.name}
              </button>
              {s.detached ? (
                <button className="stab-x" aria-label={`${s.name} 화면을 메인 창으로 돌려놓기`} title="메인 창으로 돌려놓기" onClick={() => props.onAttach(s.id)}>
                  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" style={iconStyle}>
                    <path d="M5 10.5H1.5V7M1.5 10.5L6 6M7 9.5h3.5v-8h-8V5" />
                  </svg>
                </button>
              ) : (
                detachable && (
                  <button className="stab-x" aria-label={`${s.name} 화면을 새 창으로 떼어내기`} title="화면을 통째로 새 창으로 떼어내기(다른 모니터로 옮길 수 있어요)" onClick={() => props.onDetach(s.id)}>
                    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" style={iconStyle}>
                      <path d="M7 1.5h3.5V5M10.5 1.5L6 6M5 2.5H1.5v8h8V7" />
                    </svg>
                  </button>
                )
              )}
              {closable(s) && (
                <button className="stab-x" aria-label={`${s.name} 화면 닫기`} title="화면 닫기" onClick={() => props.onClose(s.id)}>
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={iconStyle}>
                    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
                  </svg>
                </button>
              )}
            </div>
          ),
        )}
        <button aria-label="화면 탭 추가" title="화면 탭 추가" onClick={props.onAdd} style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>
          +
        </button>
      </nav>
      {menu && menuScreen && (
        <div className="stab-menu" style={{ left: menu.x, top: menu.y }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="stab-menu-title">{menuScreen.name}</div>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              setEditing(menuScreen.id);
            }}
          >
            이름 바꾸기
          </button>
          {menuScreen.detached ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  props.onSelect(menuScreen.id);
                }}
              >
                그 창으로 가기
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  props.onAttach(menuScreen.id);
                }}
              >
                메인 창으로 돌려놓기
              </button>
            </>
          ) : (
            <button
              role="menuitem"
              disabled={!detachable}
              title={detachable ? undefined : '메인 창에는 화면이 하나 이상 남아야 해요'}
              onClick={() => {
                setMenu(null);
                props.onDetach(menuScreen.id);
              }}
            >
              새 창으로 떼어내기
            </button>
          )}
          <button
            role="menuitem"
            disabled={!closable(menuScreen)}
            title={closable(menuScreen) ? undefined : '메인 창에는 화면이 하나 이상 남아야 해요'}
            onClick={() => {
              setMenu(null);
              props.onClose(menuScreen.id);
            }}
          >
            닫기
          </button>
        </div>
      )}
      <button className="btn" style={{ height: 20, padding: '0 8px', fontSize: 11 }} onClick={props.onAddPanel} title="활성 패널 옆에 새 패널">
        패널 추가
      </button>
      {props.workspaceMenu}
      <div className={`clocks ${fit.clocks === 'date' ? 'no-date' : fit.clocks === 'all' ? 'no-date no-clocks' : ''}`}>
        <span className="label clock-date">
          {seoul.year}.{pad(seoul.month)}.{pad(seoul.day)} ({DAYS[seoul.weekday]})
        </span>
        {(['KRX', 'TSE', 'LSE', 'US'] as const).map((k, i) => {
          const ex = EXCHANGES[k];
          const p = zonedParts(now, ex.timeZone);
          const s = sessionState(ex, now);
          return (
            <span key={k}>
              <span className="label">{ex.city} </span>
              <span style={{ color: 'var(--value-hi)' }}>
                {pad(p.hour)}:{pad(p.minute)}
                {i === 0 ? `:${pad(p.second)}` : ''}
              </span>{' '}
              <span className={s === 'open' ? 'open' : 'label'}>{SESSION_LABEL[s]}</span>
            </span>
          );
        })}
      </div>
    </header>
  );
}
