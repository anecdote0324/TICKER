// 워크스페이스 메뉴: 지금 배치(모든 화면 탭과 패널)를 이름을 붙여 저장하고, 저장한 배치를 불러오거나 지워요(02 화면 탭과 워크스페이스).

import { useEffect, useRef, useState } from 'react';
import type { NamedWorkspace } from '../stores/state';

const pad = (n: number) => String(n).padStart(2, '0');

function savedLabel(t: number) {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WorkspaceMenu(props: {
  current: string | undefined;
  list: NamedWorkspace[];
  onSave: (name: string) => void;
  onLoad: (w: NamedWorkspace) => void;
  onDelete: (name: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const trimmed = name.trim();
  const exists = props.list.some((w) => w.name === trimmed);
  const save = () => {
    if (!trimmed) return;
    props.onSave(trimmed);
    setName('');
    setOpen(false);
  };

  return (
    <div className="wsmenu" ref={boxRef}>
      <button
        className="btn wsmenu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title="워크스페이스 저장·불러오기"
        onClick={() => {
          setOpen((o) => !o);
          setName(props.current ?? '');
        }}
      >
        <span className="label">워크스페이스</span> {props.current ?? '저장 안 함'} ▾
      </button>
      {open && (
        <div className="wsmenu-pop" role="menu">
          <div className="wsmenu-head">저장한 워크스페이스</div>
          {props.list.length === 0 && <div className="wsmenu-empty">아직 저장한 워크스페이스가 없어요</div>}
          {props.list.map((w) => (
            <div key={w.name} className={`wsmenu-row ${w.name === props.current ? 'on' : ''}`}>
              <button
                className="wsmenu-name"
                role="menuitem"
                title="이 워크스페이스 불러오기"
                onClick={() => {
                  props.onLoad(w);
                  setOpen(false);
                }}
              >
                {w.name}
              </button>
              <span className="label mono">{savedLabel(w.savedAt)}</span>
              <button
                className="wsmenu-act"
                title="지금 배치로 덮어쓰기"
                onClick={() => {
                  props.onSave(w.name);
                  setOpen(false);
                }}
              >
                덮어쓰기
              </button>
              <button className="wsmenu-act" aria-label={`${w.name} 지우기`} title="지우기" onClick={() => props.onDelete(w.name)}>
                ✕
              </button>
            </div>
          ))}
          <div className="wsmenu-save">
            <input
              value={name}
              placeholder="이름"
              maxLength={40}
              aria-label="워크스페이스 이름"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
            <button className="btn primary" disabled={!trimmed} onClick={save}>
              {exists ? '덮어쓰기' : '지금 배치 저장'}
            </button>
          </div>
          <button
            className="wsmenu-reset"
            onClick={() => {
              props.onReset();
              setOpen(false);
            }}
          >
            기본 배치로 새로 시작
          </button>
        </div>
      )}
    </div>
  );
}
