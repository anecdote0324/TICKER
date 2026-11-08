// 패치노트 창: 업데이트한 뒤 처음 켤 때 새 버전들의 패치노트를 보여 줘요(저장소 patchnote/ 폴더, 앱에 들어 있어요).
// 설정 → 정보의 '패치노트 보기'로 언제든 다시 열어요.

import { Fragment, useEffect, useState } from 'react';
import { inlineParts, noteBlocks, notesToShow, type PatchNote } from '../patchnoteParse';
import { PATCH_NOTES } from '../patchnotes';
import { settings, updateSettings } from '../stores/settings';
import { createStore } from '../stores/store';
import { useStore } from '../stores/store';

/** 열린 창: 보여 줄 패치노트(없으면 닫힘)와 전체 보기 여부 */
export const patchNotesView = createStore<{ notes: PatchNote[]; all: boolean } | null>(null);

export function openPatchNotes(all = true) {
  patchNotesView.set({ notes: PATCH_NOTES, all });
}

const appVersion = () => window.btBridge?.version;

/** 켤 때 한 번: 지난번에 본 버전보다 새 패치노트가 있으면 창을 띄워요(데스크톱 앱에서만) */
export function usePatchNotePopup() {
  useEffect(() => {
    const current = appVersion();
    if (!current) return;
    const seen = settings.get().updates?.seen;
    const list = notesToShow(PATCH_NOTES, current, seen);
    if (list.length) {
      const t = window.setTimeout(() => patchNotesView.set({ notes: list, all: false }), 1200);
      return () => window.clearTimeout(t);
    }
    if (seen !== current) void updateSettings({ updates: { seen: current } });
  }, []);
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((p, i) =>
        p.b ? <b key={i}>{p.t}</b> : p.code ? <code key={i}>{p.t}</code> : <Fragment key={i}>{p.t}</Fragment>,
      )}
    </>
  );
}

function NoteBody({ note }: { note: PatchNote }) {
  return (
    <div className="pn-note">
      {noteBlocks(note.body).map((b, i) =>
        b.kind === 'h' ? (
          b.level === 2 ? (
            <h4 key={i}>
              <Inline text={b.text} />
            </h4>
          ) : (
            <h5 key={i}>
              <Inline text={b.text} />
            </h5>
          )
        ) : b.kind === 'li' ? (
          <div key={i} className="pn-li" style={{ paddingLeft: 14 + b.depth * 14 }}>
            <span className="pn-dot">{b.depth ? '–' : '•'}</span>
            <Inline text={b.text} />
          </div>
        ) : (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        ),
      )}
    </div>
  );
}

export function PatchNotesModal() {
  const view = useStore(patchNotesView);
  const [all, setAll] = useState(false);
  const close = () => {
    const current = appVersion();
    if (current && settings.get().updates?.seen !== current) void updateSettings({ updates: { seen: current } });
    patchNotesView.set(null);
    setAll(false);
  };
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null;
  const showAll = all || view.all;
  const notes = showAll ? PATCH_NOTES : view.notes;
  const current = appVersion();
  return (
    <div className="overlay" style={{ paddingTop: '8vh' }} onMouseDown={close}>
      <div className="modal pn-modal" role="dialog" aria-label="패치노트" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{showAll ? '패치노트' : `새 버전 v${current ?? notes[0]?.version}로 업데이트했어요`}</h2>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" aria-label="닫기" onClick={close}>
            ✕
          </button>
        </div>
        <div className="pn-body">
          {notes.length === 0 && <p className="label">아직 패치노트가 없어요</p>}
          {notes.map((n) => (
            <section key={n.version} className="pn-ver">
              <div className="pn-head">
                <b>{`v${n.version}`}</b>
                {n.date && <span className="label">{n.date}</span>}
                {current === n.version && <span className="pn-now">지금 버전</span>}
              </div>
              <NoteBody note={n} />
            </section>
          ))}
        </div>
        <div className="pn-foot">
          {!showAll && PATCH_NOTES.length > notes.length && (
            <button className="linkish" onClick={() => setAll(true)}>
              지난 패치노트도 보기
            </button>
          )}
          <span style={{ flex: 1 }} />
          <span className="label">설정 → 정보 → 패치노트 보기로 다시 열어요</span>
          <button className="btn primary" onClick={close}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
