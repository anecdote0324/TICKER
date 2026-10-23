// 맨 위 줄: 로고, 화면 탭(Market Pulse, +), 날짜, 서울·도쿄·런던·뉴욕 시계와 장 상태(02).

import { useState, type ReactNode } from 'react';
import { EXCHANGES, SESSION_LABEL, sessionState, zonedParts } from '@bt/shared';
import { useNow } from '../hooks/useNow';

export interface Screen {
  id: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function TopBar(props: {
  screens: Screen[];
  active: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onAddPanel: () => void;
  workspaceMenu?: ReactNode;
}) {
  // 화면 탭이 하나뿐이면 닫을 수 없어요
  const closable = props.screens.length > 1;
  const now = useNow(1000);
  const [editing, setEditing] = useState<string | null>(null);
  const seoul = zonedParts(now, 'Asia/Seoul');
  return (
    <header className="topbar">
      <div className="logo">
        <i />
        <b>TERMINAL</b>
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
            <div key={s.id} className={`stab ${s.id === props.active ? 'on' : ''}`}>
              <button className="stab-name" onClick={() => props.onSelect(s.id)} onDoubleClick={() => setEditing(s.id)} title="두 번 눌러 이름 바꾸기">
                {s.name}
              </button>
              {closable && (
                <button className="stab-x" aria-label={`${s.name} 화면 닫기`} title="화면 닫기" onClick={() => props.onClose(s.id)}>
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }}>
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
        <span className="label">
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
