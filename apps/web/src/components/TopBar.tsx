// 맨 위 줄: 로고, 화면 탭(Market Pulse, +), 날짜, 서울·도쿄·런던·뉴욕 시계와 장 상태(02).
// 화면 탭은 새 창으로 떼어낼 수 있어요. 떼어낸 탭을 누르면 그 창을 앞으로 가져와요.

import { useState, type ReactNode } from 'react';
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
  return (
    <header className="topbar">
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
      <div className="clocks">
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
