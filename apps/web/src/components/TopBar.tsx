// 맨 위 줄: 로고, 화면 탭(Market Pulse, +), 날짜, 서울·도쿄·런던·뉴욕 시계와 장 상태(02).
// 화면 탭은 새 창으로 떼어낼 수 있어요. 떼어낸 탭을 누르면 그 창을 앞으로 가져와요.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/** 화면 탭 이름이 가장 짧아졌을 때의 너비(styles.css .stab-name min-width와 같아요) */
const TAB_NAME_MIN = 40;

/**
 * 맨 위 줄이 좁을 때 무엇부터 줄일지(사용자 결정): 화면 탭 이름을 가장 먼저 줄이고(CSS flex-shrink),
 * 탭을 다 줄여도 모자라면 날짜를 숨기고, 그래도 모자라면 뒤쪽 시계(뉴욕→런던→도쿄)를 숨겨요(CSS 줄넘김).
 * 날짜를 숨길지는 '탭을 가장 짧게 줄였을 때 시계 칸에 남는 자리'로 정해요
 */
function useHideDate(tabCount: number) {
  const ref = useRef<HTMLElement>(null);
  const widths = useRef(new Map<number, number>());
  const [hide, setHide] = useState<'none' | 'date' | 'all'>('none');
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    const check = () => {
      const kids = [...header.children] as HTMLElement[];
      const tabs = header.querySelector<HTMLElement>('.screen-tabs');
      const clocks = header.querySelector<HTMLElement>('.clocks');
      if (!tabs || !clocks) return;
      // 시계 칸 각 항목의 너비(숨긴 날짜는 지난번에 잰 값)
      [...clocks.children].forEach((c, i) => {
        const w = (c as HTMLElement).offsetWidth;
        if (w > 0) widths.current.set(i, w);
      });
      const items = clocks.children.length;
      let need = 0;
      for (let i = 0; i < items; i++) need += widths.current.get(i) ?? 0;
      need += 16 * Math.max(0, items - 1);
      // 탭을 가장 짧게 줄였을 때의 탭 칸 너비
      // (CSS의 min-content는 줄인 이름이 아니라 전체 이름 너비라서, 탭과 탭 칸의 가장 짧은 너비를 여기서 정해 줘요)
      let tabsMin = 0;
      for (const t of [...tabs.children] as HTMLElement[]) {
        const name = t.querySelector<HTMLElement>('.stab-name');
        // 이름 말고 다른 것(떼어내기·닫기 단추)은 줄지 않아서 그 너비 그대로 + 이름은 40px(더 짧은 이름이면 그 너비)
        let min = name ? Math.min(name.scrollWidth, TAB_NAME_MIN) : 0;
        for (const c of [...t.children] as HTMLElement[]) {
          if (c === name) continue;
          const st = getComputedStyle(c);
          min += c.offsetWidth + (parseFloat(st.marginLeft) || 0) + (parseFloat(st.marginRight) || 0);
        }
        if (!name) min = t.offsetWidth;
        if (name && t.style.minWidth !== `${min}px`) t.style.minWidth = `${min}px`;
        tabsMin += min;
      }
      if (tabs.style.minWidth !== `${tabsMin}px`) tabs.style.minWidth = `${tabsMin}px`;
      const cs = getComputedStyle(header);
      const gap = parseFloat(cs.columnGap) || 0;
      let others = 0;
      for (const k of kids) if (k !== tabs && k !== clocks) others += k.offsetWidth;
      const avail = header.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * (kids.length - 1) - others - tabsMin;
      // 서울 시계 하나도 다 들어가지 않으면 반쯤 잘린 시계 대신 시계 칸을 비워요
      const seoulW = widths.current.get(1) ?? 0;
      setHide(avail >= need ? 'none' : avail >= seoulW ? 'date' : 'all');
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(header);
    return () => ro.disconnect();
  }, [tabCount]);
  return { ref, hide };
}
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

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
  const fit = useHideDate(props.screens.length);
  return (
    <header className="topbar" ref={fit.ref}>
      <div className="logo">
        <i />
        <b>TICKER</b>
      </div>
      <nav className="screen-tabs" aria-label="화면 탭">
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
            <div key={s.id} className={`stab ${s.id === props.active && !s.detached ? 'on' : ''} ${s.detached ? 'detached' : ''}`}>
              <button
                className="stab-name"
                onClick={() => props.onSelect(s.id)}
                onDoubleClick={() => setEditing(s.id)}
                title={s.detached ? '다른 창에 떼어낸 화면이에요. 눌러서 그 창으로 가기 · 두 번 눌러 이름 바꾸기' : '두 번 눌러 이름 바꾸기'}
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
      <button className="btn" style={{ height: 20, padding: '0 8px', fontSize: 11 }} onClick={props.onAddPanel} title="활성 패널 옆에 새 패널">
        패널 추가
      </button>
      {props.workspaceMenu}
      <div className={`clocks ${fit.hide === 'date' ? 'no-date' : fit.hide === 'all' ? 'no-date no-clocks' : ''}`}>
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
