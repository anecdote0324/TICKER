// 화면 탭을 통째로 떼어낸 창(02 화면 탭과 워크스페이스). 같은 출처의 새 창을 열고, 그 창의 화면들의 패널 배치를
// 메인 창의 React가 그 창의 문서 안에 그려요. 시세·종목 색인·설정·연동 그룹은 메인 창과 함께 써요.
// 한 창에 화면 탭을 여러 개 둘 수 있어요(v0.2). 창의 닫기(X)를 누르면 그 창의 화면이 모두 메인 창으로 돌아와요.
// 창의 위치·크기는 기억해서 다음에 떼어낼 때와 다음 실행 때 써요.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { preparePopoutDocument, releasePopoutDocument } from '../popout';
import { screenWindows } from '../stores/windows';
import type { ScreenBounds } from './TopBar';
import { dockApis } from './Workspace';

const DEFAULT_SIZE = { width: 1280, height: 800 };
const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 };

function sameBounds(a: ScreenBounds | undefined, b: ScreenBounds) {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function ScreenWindow(props: {
  /** 창 id(처음 떼어낸 화면의 id) */
  winId: string;
  /** 창 제목에 쓸 이름(보이는 화면 탭) */
  title: string;
  bounds?: ScreenBounds;
  /** 이 창에 그리는 화면들(크기가 바뀌면 다시 배치) */
  screenIds: string[];
  children: ReactNode;
  /** 사용자가 창을 닫았어요. 화면을 메인 창으로 돌려요 */
  onClosed: (bounds?: ScreenBounds) => void;
  /** 창을 열지 못했어요(팝업 차단 등) */
  onFailed: () => void;
  /** 창을 옮기거나 크기를 바꿨어요 */
  onBounds: (bounds: ScreenBounds) => void;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const id = props.winId;
  const name = props.title;

  useEffect(() => {
    const b = cb.current.bounds;
    const box = b ? { left: b.x, top: b.y, width: b.width, height: b.height } : DEFAULT_SIZE;
    const features = Object.entries(box)
      .map(([k, v]) => `${k}=${Math.round(v)}`)
      .join(',');
    let win: Window | null = null;
    try {
      win = window.open('popout.html', `ticker-screen-${id}`, features);
    } catch {
      win = null;
    }
    if (!win) {
      cb.current.onFailed();
      return;
    }
    const w = win;
    // 우리가 닫았거나 닫힘을 이미 처리했으면 참
    let done = false;
    let doc: Document | null = null;
    let last = b;
    const timers: number[] = [];

    const relayout = () => {
      // 보이는 화면만 크기가 있어요. 숨은 화면은 보일 때 Workspace가 다시 맞춰요
      for (const sid of cb.current.screenIds) {
        const el = doc?.querySelector<HTMLElement>(`.workspace[data-screen="${sid}"]`) ?? doc?.querySelector<HTMLElement>('.workspace');
        const api = dockApis.get(sid);
        if (el && api && el.clientWidth > 0 && el.clientHeight > 0) api.layout(el.clientWidth, el.clientHeight, true);
      }
    };
    const onResize = () => w.requestAnimationFrame(relayout);
    const release = () => {
      window.clearInterval(poll);
      for (const t of timers) window.clearTimeout(t);
      window.removeEventListener('beforeunload', closeWithMain);
      if (screenWindows.get(id) === w) screenWindows.delete(id);
      releasePopoutDocument(doc);
    };
    const closedByUser = () => {
      if (done) return;
      done = true;
      release();
      cb.current.onClosed(last);
    };
    // 메인 창이 닫히거나 새로 고쳐지면 떼어낸 창도 닫아요. 화면은 떼어낸 채로 저장돼 다음 실행 때 다시 열려요
    const closeWithMain = () => {
      done = true;
      w.close();
    };
    window.addEventListener('beforeunload', closeWithMain);

    // 닫힘 확인(beforeunload가 오지 않는 경우 대비)과 창 위치 기억. 창이 옮겨져도 이벤트가 없어서 1초마다 봐요
    const poll = window.setInterval(() => {
      if (w.closed) {
        closedByUser();
        return;
      }
      try {
        const next = { x: w.screenX, y: w.screenY, width: w.outerWidth, height: w.outerHeight };
        // 전체 화면일 때의 크기는 기억하지 않아요(다음에 열 때는 전체 화면 전의 크기로)
        const fullScreen = next.width >= w.screen.width && next.height >= w.screen.height;
        if (next.width > 0 && next.height > 0 && !fullScreen && !sameBounds(last, next)) {
          last = next;
          cb.current.onBounds(next);
        }
      } catch {
        // 닫히는 중
      }
    }, 1000);

    w.addEventListener(
      'load',
      () => {
        try {
          doc = preparePopoutDocument(w);
          doc.title = `TICKER · ${cb.current.title}`;
          const el = doc.createElement('div');
          el.className = 'app screen-window';
          doc.body.appendChild(el);
          // beforeunload는 load 뒤에 붙여야 창을 닫을 때 와요
          w.addEventListener('beforeunload', closedByUser);
          w.addEventListener('resize', onResize);
          screenWindows.set(id, w);
          setRoot(el);
          // 새 창은 그려진 뒤에야 크기를 알 수 있어서 몇 번 더 맞춰요
          for (const ms of [50, 250, 800]) timers.push(window.setTimeout(relayout, ms));
        } catch {
          done = true;
          release();
          w.close();
          cb.current.onFailed();
        }
      },
      { once: true },
    );

    return () => {
      const wasOpen = !done;
      done = true;
      release();
      if (wasOpen) w.close();
    };
  }, [id]);

  // 화면 이름을 바꾸면 창 제목도 바꿔요
  useEffect(() => {
    if (root) root.ownerDocument.title = `TICKER · ${name}`;
  }, [root, name]);

  return root ? createPortal(props.children, root) : null;
}

/** 떼어낸 화면 창의 맨 위 줄(v0.2): 이 창의 화면 탭들(고르기·이름 바꾸기·닫기·메인 창으로), 화면 추가, 패널 추가 */
export function ScreenWindowBar(props: {
  tabs: Array<{ id: string; name: string }>;
  active: string;
  onSelect: (id: string) => void;
  onAddScreen: () => void;
  onRename: (id: string, name: string) => void;
  onCloseTab: (id: string) => void;
  onAttach: (id: string) => void;
  onAddPanel: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const many = props.tabs.length > 1;
  return (
    <header className="topbar">
      <div className="logo">
        <i />
        <b>TICKER</b>
      </div>
      <nav className="screen-tabs" aria-label="화면 탭">
        {props.tabs.map((t) => (
          <div key={t.id} className={`stab ${t.id === props.active ? 'on' : ''}`}>
            {editing === t.id ? (
              <input
                className="stab-edit"
                defaultValue={t.name}
                autoFocus
                onBlur={(e) => {
                  setEditing(null);
                  const v = e.currentTarget.value.trim();
                  if (v) props.onRename(t.id, v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <button className="stab-name" onClick={() => props.onSelect(t.id)} onDoubleClick={() => setEditing(t.id)} title="두 번 눌러 이름 바꾸기">
                {t.name}
              </button>
            )}
            <button className="stab-x" aria-label={`${t.name} 화면을 메인 창으로 돌려놓기`} title="메인 창으로 돌려놓기" onClick={() => props.onAttach(t.id)}>
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" style={ICON}>
                <path d="M5 10.5H1.5V7M1.5 10.5L6 6M7 9.5h3.5v-8h-8V5" />
              </svg>
            </button>
            {many && (
              <button className="stab-x" aria-label={`${t.name} 화면 닫기`} title="화면 닫기(알림에서 되돌릴 수 있어요)" onClick={() => props.onCloseTab(t.id)}>
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={ICON}>
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button aria-label="이 창에 화면 탭 추가" title="이 창에 화면 탭 추가" onClick={props.onAddScreen} style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>
          +
        </button>
      </nav>
      <button className="btn" style={{ height: 20, padding: '0 8px', fontSize: 11 }} onClick={props.onAddPanel} title="활성 패널 옆에 새 패널">
        패널 추가
      </button>
      <span style={{ marginLeft: 'auto' }} className="label">
        창을 닫으면 이 창의 화면이 모두 메인 창으로 돌아가요
      </span>
    </header>
  );
}
