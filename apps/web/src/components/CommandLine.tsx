// 커맨드 라인(05). Tab은 채우고 Enter는 실행해요. 애매하면 Enter를 두 번.
// 입력칸 구현은 05 §9의 (a)안: 글자를 투명하게 한 입력칸 아래에 같은 글꼴의 거울 줄을 두고, 칩·밑줄·흐린 글씨를 거울에 그려요.
// 한글을 조합하는 동안에는 입력칸 글자를 보이게 바꿔서 조합 중인 글자가 사라지지 않게 해요.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, ChosenToken, EngineContext, Execution, Row } from '@bt/command';
import { ASSET_LABEL, canonicalSecurity, displayName, FUNCTIONS, MARKET_LABEL, type AssetClass, type Instrument } from '@bt/shared';
import { api } from '../api';
import { logIme } from '../imeLog';
import { isShortcut } from '../keys';
import { recordAnalyze } from '../perf';
import { feedStatus } from '../stores/feed';
import { engine, getInstrument, index, indexState, supports } from '../stores/instruments';
import { applyExecution, panelCanonical, panels, type PanelState } from '../stores/panels';
import { settings, updateSettings } from '../stores/settings';
import { checkSlots } from '../stores/slots';
import { appState, updateState, usageScore } from '../stores/state';
import { useStore } from '../stores/store';
import { openHelp, openSettings, showToast, ui } from '../stores/ui';
import { CandidateList } from './CandidateList';

interface Props {
  panelId: string;
  variant?: 'panel' | 'palette';
  autoFocus?: boolean;
  onDone?: () => void;
  /** 빈 줄에서 Esc: 패널 본문으로 포커스(05 §10.1) */
  onEscapeEmpty?: () => void;
}

interface Intent {
  /** click: 조합 중에 목록 줄을 눌렀을 때(K8), run: 더블클릭 */
  kind: 'tab' | 'enter' | 'down' | 'up' | 'esc' | 'click' | 'run';
  code: string;
  rowId: string | null;
  used: boolean;
}

/** 자산군 단축키(눌린 자리로 알아봐서 한글 모드에서도 같아요, 05 §2) */
const ASSET_SHORTCUTS = [
  ['assetEquity', 'EQUITY'],
  ['assetCrypto', 'CRYPTO'],
  ['assetCurncy', 'CURNCY'],
  ['assetIndex', 'INDEX'],
] as const satisfies ReadonlyArray<readonly [string, AssetClass]>;

export function CommandLine({ panelId, variant = 'panel', autoFocus, onDone, onEscapeEmpty }: Props) {
  const panel = useStore(panels, (all) => all[panelId]) as PanelState | undefined;
  const st = useStore(settings);
  const app = useStore(appState);
  const idx = useStore(indexState);
  // 한국투자증권이 연결돼 있으면 목록에 없는 코드를 직접 조회할 수 있어요(05 §4.5)
  const canLookup = useStore(feedStatus, (f) => !f.demo);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [han, setHan] = useState<'on' | 'off' | 'unknown'>('off');
  const [listOpen, setListOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listSegment, setListSegment] = useState<number | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [desc, setDesc] = useState<'auto' | 'card' | 'syntax'>('auto');
  const [chosen, setChosen] = useState<ChosenToken[]>([]);
  const [labelFlash, setLabelFlash] = useState(false);
  const [historyPos, setHistoryPos] = useState(-1);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const helped = useRef(false);
  const intent = useRef<Intent | null>(null);
  const swallow = useRef<{ code: string; until: number } | null>(null);
  const composingRef = useRef(false);

  const assist = st.commandLine.assist;
  const fn = panel?.fn ? FUNCTIONS.find((f) => f.code === panel.fn) : undefined;
  const security = getInstrument(panel?.securityId);

  const ctx = useMemo<EngineContext>(
    () => ({
      panel: { security, fn: panel?.fn },
      assist,
      hanEng: st.commandLine.hanEngCorrection,
      tabAutofill: st.commandLine.tabAutofill,
      supports,
      usage: usageScore,
      fnUsage: (asset) =>
        Object.entries(app.fnUsage[asset] ?? {})
          .sort((a, b) => b[1] - a[1])
          .map(([k]) => k),
      remembered: (q) => app.remembered[q],
      userDefault: (k) => app.defaults.chosen[k],
      watchlist: new Set(app.watchlists.flatMap((g) => g.ids)),
      chosen,
      recent: [...new Set(app.history.map((h) => h.cmd))].slice(0, 5),
      lookup: canLookup,
    }),
    // idx.count: 색인이 바뀌면 다시 계산
    [security, panel?.fn, assist, st.commandLine.hanEngCorrection, st.commandLine.tabAutofill, app, chosen, idx.count, canLookup],
  );

  // 고른 토큰은 그 글자가 그대로인 동안만 유지돼요
  useEffect(() => {
    setChosen((c) => c.filter((x) => text.slice(x.start, x.start + x.text.length) === x.text));
  }, [text]);

  const analysis: Analysis = useMemo(() => {
    const t0 = performance.now();
    const a = engine.analyze(text, cursor, ctx, { composing, listSegment, expanded });
    if (text) recordAnalyze(performance.now() - t0);
    return a;
  }, [text, cursor, ctx, composing, listSegment, expanded]);

  // 목록이 바뀌면 강조를 1번·선택 없음으로(K5)
  const rowsKey = analysis.rows.map((r) => r.id).join('|');
  useEffect(() => {
    const first = analysis.rows.findIndex((r) => r.kind !== 'header');
    setHighlight(first < 0 ? 0 : first);
    setSelectedId((s) => (s && analysis.rows.some((r) => r.id === s) ? s : null));
  }, [rowsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // 거울 줄을 입력칸의 가로 스크롤에 맞춰요
  const syncScroll = useCallback(() => {
    const inp = inputRef.current;
    const m = mirrorRef.current;
    if (inp && m) m.style.transform = `translateX(${-inp.scrollLeft}px)`;
  }, []);
  useLayoutEffect(syncScroll);

  // 목록 위치
  useLayoutEffect(() => {
    if (!focused) return;
    const r = fieldRef.current?.getBoundingClientRect();
    if (r) setAnchor(r);
  }, [focused, text, listOpen]);

  // 보이는 것(도움 수준, 05 §11.1)
  const hasText = text.trim().length > 0;
  let showList = false;
  if (focused && !dismissed) {
    if (assist === 'beginner') showList = hasText || listOpen || analysis.rows.length > 0;
    else if (assist === 'standard') showList = hasText || listOpen;
    else if (assist === 'expert') showList = listOpen || (hasText && analysis.needsAttention && !composing);
    else showList = listOpen;
  }
  showList = showList && analysis.rows.length > 0;
  const ghost = assist !== 'off' && focused && !dismissed ? analysis.ghost : null;

  // ── 입력칸 쓰기: execCommand로 써서 Ctrl+Z 되돌리기 기록을 살려요(05 §9.2) ──
  const writeInput = useCallback((next: string, caret: number) => {
    const inp = inputRef.current;
    if (!inp) return;
    inp.focus();
    inp.setSelectionRange(0, inp.value.length);
    const doc = inp.ownerDocument;
    const ok = next === '' ? doc.execCommand('delete') : doc.execCommand('insertText', false, next);
    if (!ok || inp.value !== next) inp.value = next;
    inp.setSelectionRange(caret, caret);
    setText(next);
    setCursor(caret);
  }, []);

  const resetLine = useCallback(() => {
    setListOpen(false);
    setSelectedId(null);
    setListSegment(undefined);
    setExpanded(false);
    setHistoryPos(-1);
    setChosen([]);
    helped.current = false;
  }, []);

  // ── 실행 ──
  const run = useCallback(
    (exec: Execution, via?: { row?: Row; query?: string }) => {
      if (exec.kind === 'command') {
        if (exec.cmd === 'settings') openSettings();
        else openHelp(exec.cmd === 'syntax' ? 'syntax' : 'help');
      } else if (exec.kind === 'lookup' && exec.lookup) {
        const { code, market } = exec.lookup;
        const fnCode = exec.fn ?? 'GP';
        showToast(`${code}를 한국투자증권에서 찾는 중…`);
        api
          .get<Instrument>(`/api/lookup?code=${encodeURIComponent(code)}&market=${market}`)
          .then((inst) => {
            index.addInstrument(inst);
            indexState.set((s) => ({ ...s, count: s.count + 1 }));
            applyExecution(panelId, { kind: 'function', fn: fnCode, instrumentId: inst.id, canonical: `${canonicalSecurity(inst)} ${fnCode}`, notes: ['직접 조회'] });
            checkSlots();
            showToast(`${code} ${inst.nameKo ?? inst.nameEn ?? ''}를 찾았어요. 이번 실행 동안 목록에 넣어 둘게요`);
          })
          .catch((e: Error) => showToast(`직접 조회 실패: ${e.message}`, undefined, 10000));
      } else if (exec.kind === 'asset-list') {
        showToast(`${exec.asset === 'EQUITY' ? '주식' : '종목'}은 코드나 이름으로 찾아요. 예: 005930, 삼성, AAPL`);
      } else {
        applyExecution(panelId, exec);
        checkSlots();
      }
      // 기억된 선택(↺)과 겹침 기본값(05 §7.4)
      if (via?.row && via.query) {
        const q = via.query.toLowerCase();
        updateState('remembered', (m) => ({ ...m, [q]: via.row!.id }));
        const seg = analysis.segments.find((s) => s.slot === 'security');
        if (seg && seg.chooseReason === 'ambiguous' && via.row.instrumentId) {
          const key = seg.text.toUpperCase();
          const firstId = analysis.rows.find((r) => r.kind === 'security')?.instrumentId;
          if (via.row.instrumentId !== firstId) {
            const picks = { ...(appState.get().defaults.picks[key] ?? {}) };
            picks[via.row.instrumentId] = (picks[via.row.instrumentId] ?? 0) + 1;
            const becomeDefault = picks[via.row.instrumentId] >= 2;
            updateState('defaults', (d) => ({
              chosen: becomeDefault ? { ...d.chosen, [key]: via.row!.instrumentId! } : d.chosen,
              picks: { ...d.picks, [key]: picks },
            }));
            if (becomeDefault) {
              const inst = getInstrument(via.row.instrumentId);
              showToast(`이제 ${key}⏎는 ${inst?.code} ${inst?.market ?? inst?.assetClass}(${inst?.nameKo ?? inst?.nameEn ?? ''})로 열려요`, {
                label: '되돌리기',
                run: () =>
                  updateState('defaults', (d) => {
                    const c = { ...d.chosen };
                    delete c[key];
                    return { ...d, chosen: c };
                  }),
              });
            }
          }
        }
      }
      // 팁과 표준 제안(05 §12.2, §11.1)
      const tips = appState.get().tips;
      if (assist === 'beginner' && st.commandLine.tips && helped.current && exec.kind === 'function' && exec.instrumentId) {
        const inst = getInstrument(exec.instrumentId);
        const short = inst ? `${inst.market === 'US' ? `${inst.code} US` : inst.code} ${exec.fn}` : exec.canonical;
        const id = `short:${short}`;
        if ((tips.counts[id] ?? 0) < 3 && !tips.hidden.includes(id)) {
          updateState('tips', (t) => ({ ...t, counts: { ...t.counts, [id]: (t.counts[id] ?? 0) + 1 } }));
          showToast(`다음엔 ${short} ⏎ 만 입력해도 돼요`, { label: '그만 보기', run: () => updateState('tips', (t) => ({ ...t, hidden: [...t.hidden, id] })) });
        }
      }
      if (assist === 'beginner' && !helped.current) {
        const n = tips.directRuns + 1;
        updateState('tips', (t) => ({ ...t, directRuns: n }));
        if (n >= 30 && !tips.standardAsked) {
          updateState('tips', (t) => ({ ...t, standardAsked: true }));
          showToast('표준으로 바꿀까요? 목록은 그대로 보이고 키 안내·팁만 줄어요', { label: '바꾸기', run: () => void updateSettings({ commandLine: { assist: 'standard' } }) }, 15000);
        }
      }
      writeInput('', 0);
      resetLine();
      setDismissed(false);
      onDone?.();
    },
    [analysis, assist, onDone, panelId, resetLine, st.commandLine.tips, writeInput],
  );

  const flashLabel = () => {
    setLabelFlash(true);
    window.setTimeout(() => setLabelFlash(false), 400);
  };

  // ── Tab·클릭: 채우기(05 §2) ──
  const acceptRow = useCallback(
    (row: Row, a: Analysis = analysis) => {
      helped.current = true;
      const r = engine.applyRow(a, row, ctx);
      if (r.noop) {
        flashLabel();
        return;
      }
      if (r.chosen) setChosen((c) => [...c.filter((x) => x.start !== r.chosen!.start), r.chosen!]);
      writeInput(r.input, r.cursor);
      setSelectedId(null);
      setListSegment(undefined);
      setExpanded(false);
      setListOpen(!r.closeList);
    },
    [analysis, ctx, writeInput],
  );

  // ── Enter(05 §3.6) ──
  const doEnter = useCallback(
    (selected: string | null = selectedId) => {
      const query = analysis.segments[analysis.listSegment]?.text ?? analysis.segments[0]?.text;
      const row = selected ? analysis.rows.find((r) => r.id === selected) : undefined;
      const out = engine.enter(analysis, ctx, selected ?? undefined);
      switch (out.kind) {
        case 'execute':
          run(out.exec, row ? { row, query } : undefined);
          break;
        case 'select':
          setSelectedId(out.rowId);
          setListSegment(out.segment);
          setListOpen(true);
          setDismissed(false);
          setHighlight(Math.max(0, analysis.rows.findIndex((r) => r.id === out.rowId)));
          break;
        case 'accepted':
          helped.current = true;
          if (out.chosen) setChosen((c) => [...c, out.chosen!]);
          writeInput(out.input, out.cursor);
          setSelectedId(null);
          setListSegment(undefined);
          setListOpen(true);
          if (row && query) updateState('remembered', (m) => ({ ...m, [query.toLowerCase()]: row.id }));
          break;
        case 'need-security':
        case 'error':
        case 'nomatch':
          setListOpen(true);
          setDismissed(false);
          flashLabel();
          break;
        case 'empty':
          setListOpen(true);
          setDismissed(false);
          break;
      }
    },
    [analysis, ctx, run, selectedId, writeInput],
  );

  const moveHighlight = (delta: number) => {
    const rows = analysis.rows;
    if (rows.length === 0) return;
    let i = highlight;
    for (let n = 0; n < rows.length; n++) {
      i = Math.max(0, Math.min(rows.length - 1, i + (n === 0 ? delta : Math.sign(delta))));
      if (rows[i].kind !== 'header') break;
    }
    setHighlight(i);
    setSelectedId(rows[i].disabled ? null : rows[i].id);
    helped.current = true;
  };

  const runIntent = (it: Intent) => {
    it.used = true;
    logIme(null, `의도 실행: ${it.kind} ${it.rowId ?? ''}`);
    const rows = analysis.rows;
    const row = it.rowId ? rows.find((r) => r.id === it.rowId) : undefined;
    // 기록한 줄이 새 목록에 없으면 1번을 강조만 해요(K3-7)
    if (it.rowId && !row) {
      setHighlight(0);
      setSelectedId(null);
      return;
    }
    if (it.kind === 'tab' || it.kind === 'click') {
      const target = row ?? rows[highlight];
      if (target) acceptRow(target);
    } else if (it.kind === 'run') {
      if (row) setSelectedId(row.id);
      doEnter(row?.id ?? null);
    } else if (it.kind === 'enter') doEnter(it.rowId);
    else if (it.kind === 'down') moveHighlight(1);
    else if (it.kind === 'up') moveHighlight(-1);
    else if (it.kind === 'esc') setDismissed(true);
  };

  // ── 키 처리 ──
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const ne = e.nativeEvent;
    logIme(ne);
    const isComposingKey = ne.isComposing || ne.keyCode === 229 || composingRef.current;
    const key = e.key;
    const code = e.code;

    // 조합 중: 의도만 기록하고 음절이 끝난 뒤 한 번만 실행(K3)
    if (isComposingKey) {
      const map: Record<string, Intent['kind']> = { Tab: 'tab', Enter: 'enter', NumpadEnter: 'enter', ArrowDown: 'down', ArrowUp: 'up', Escape: 'esc' };
      const kind = map[code];
      if (kind) {
        if (kind === 'tab') e.preventDefault();
        const rows = analysis.rows;
        const target = kind === 'down' ? rows[Math.min(rows.length - 1, highlight + 1)] : kind === 'up' ? rows[Math.max(0, highlight - 1)] : kind === 'enter' ? rows.find((r) => r.id === selectedId) : rows[highlight];
        intent.current = { kind, code, rowId: target?.id ?? null, used: false };
        logIme(null, `의도 기록: ${kind} ${target?.id ?? ''}`);
      }
      return;
    }
    // 조합이 끝난 뒤 처음 오는 진짜 키: 기록한 의도를 딱 한 번 실행
    if (intent.current && !intent.current.used) {
      const it = intent.current;
      intent.current = null;
      if (it.code === code || (it.kind === 'enter' && (code === 'Enter' || code === 'NumpadEnter'))) {
        e.preventDefault();
        runIntent(it);
        return;
      }
    }
    if (swallow.current && swallow.current.code === code && Date.now() < swallow.current.until) {
      e.preventDefault();
      logIme(null, `늦게 온 ${code} 삼킴`);
      return;
    }
    swallow.current = null;

    if ((key === 'Enter' || key === 'Tab') && e.repeat) {
      e.preventDefault();
      return;
    }

    // 자산군 단축키 Mod+Shift+E/C/X/I(05 §10.2). 설정에서 바꿀 수 있어요
    const asset = ASSET_SHORTCUTS.find(([id]) => isShortcut(ne, id))?.[1];
    if (asset) {
      e.preventDefault();
      const t = text.trimEnd();
      const next = t ? `${t} ${asset} ` : `${asset} `;
      writeInput(next, next.length);
      setListOpen(true);
      return;
    }
    // 지금 칸 목록 열기(Alt+↓, Windows Ctrl+Space)
    if (isShortcut(ne, 'openList')) {
      e.preventDefault();
      setListOpen(true);
      setDismissed(false);
      return;
    }
    if (isShortcut(ne, 'descCard')) {
      e.preventDefault();
      setDesc((d) => (d === 'card' ? 'syntax' : 'card'));
      setListOpen(true);
      return;
    }
    // 패널 본문으로(Windows Ctrl+↓, 05 §10.1)
    if (isShortcut(ne, 'bodyFocus') && variant === 'panel') {
      e.preventDefault();
      setListOpen(false);
      onEscapeEmpty?.();
      return;
    }

    switch (key) {
      case 'Tab': {
        if (e.shiftKey) {
          // 직접 고른 이전 토큰을 다시 열어 고쳐요
          const segs = analysis.segments.filter((s) => s.slot === 'security' || s.slot === 'function' || s.slot === 'closed');
          const prev = [...segs].reverse().find((s) => s.end < cursor) ?? segs[0];
          if (!prev && !hasText) return;
          e.preventDefault();
          if (prev) {
            inputRef.current?.setSelectionRange(prev.end, prev.end);
            setCursor(prev.end);
            setListSegment(prev.index);
            setListOpen(true);
          }
          return;
        }
        const rows = analysis.rows;
        // 빈 줄이고 목록이 없으면 보통처럼 포커스를 옮겨요(입문 시작 목록만 예외, 05 §10.1)
        if (!hasText && !(assist === 'beginner' && showList)) return;
        e.preventDefault();
        if (!showList && assist !== 'off' && rows.length > 0 && analysis.plan.kind !== 'execute') {
          // 전문가: Tab에 목록을 열면서 채워요
          setListOpen(true);
        }
        const row = rows[highlight];
        if (row && !row.disabled && row.kind !== 'header') acceptRow(row);
        else flashLabel();
        return;
      }
      case 'Enter': {
        e.preventDefault();
        doEnter();
        return;
      }
      case 'ArrowDown': {
        e.preventDefault();
        if (!showList) {
          setListOpen(true);
          setDismissed(false);
          return;
        }
        moveHighlight(1);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        // 빈 줄: 기록(이 패널 먼저, 그다음 모든 패널, 최신순)
        if (!hasText || historyPos >= 0) {
          const hist = [...app.history.filter((h) => h.panel === panelId), ...app.history.filter((h) => h.panel !== panelId)].map((h) => h.cmd);
          const uniq = [...new Set(hist)];
          const pos = historyPos + 1;
          if (pos < uniq.length) {
            setHistoryPos(pos);
            writeInput(uniq[pos], uniq[pos].length);
            setDismissed(true);
          }
          return;
        }
        if (highlight <= analysis.rows.findIndex((r) => r.kind !== 'header')) {
          setSelectedId(null);
          setListOpen(false);
          setDismissed(true);
          return;
        }
        moveHighlight(-1);
        return;
      }
      case 'PageDown':
        if (showList) {
          e.preventDefault();
          moveHighlight(8);
        }
        return;
      case 'PageUp':
        if (showList) {
          e.preventDefault();
          moveHighlight(-8);
        }
        return;
      case 'ArrowRight':
      case 'End': {
        const inp = inputRef.current!;
        if (ghost && inp.selectionStart === text.length && inp.selectionEnd === text.length) {
          e.preventDefault();
          const seg = analysis.segments[analysis.current];
          let next: string;
          if (ghost.replace && seg) next = text.slice(0, seg.start) + ghost.tab + ghost.rest;
          else if (e.ctrlKey || e.altKey) {
            // 다음 토큰 하나만
            const m = (ghost.tab + ghost.rest).match(/^\s*\S+/);
            next = text + (m ? m[0] : '');
          } else next = text + ghost.tab + ghost.rest;
          helped.current = true;
          writeInput(next, next.length);
        }
        return;
      }
      case 'Escape': {
        e.preventDefault();
        if (ui.get().help) {
          ui.set((s) => ({ ...s, help: null }));
          return;
        }
        if ((showList || ghost) && !dismissed) {
          setDismissed(true);
          setListOpen(false);
          setSelectedId(null);
          return;
        }
        if (hasText) {
          writeInput('', 0);
          resetLine();
          return;
        }
        if (variant === 'palette') onDone?.();
        else onEscapeEmpty?.();
        return;
      }
      case 'Delete': {
        const row = analysis.rows[highlight];
        if (e.shiftKey && row?.remembered) {
          e.preventDefault();
          const q = (analysis.segments[analysis.listSegment]?.text ?? '').toLowerCase();
          updateState('remembered', (m) => {
            const n = { ...m };
            delete n[q];
            return n;
          });
        }
        return;
      }
      default:
        break;
    }
    // 영문 글자를 치면 [한] 배지를 꺼요(K10)
    if (/^Key[A-Z]$/.test(code) && /^[a-zA-Z]$/.test(key)) setHan('off');
    if (code === 'Lang1' || key === 'HangulMode') setHan('unknown');
  };

  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    logIme(e.nativeEvent);
    const inp = e.currentTarget;
    setText(inp.value);
    setCursor(inp.selectionStart ?? inp.value.length);
    setDismissed(false);
    setHistoryPos(-1);
    if (!composingRef.current) setListSegment(undefined);
    syncScroll();
  };

  const onSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const pos = e.currentTarget.selectionStart ?? 0;
    if (pos !== cursor) setCursor(pos);
    syncScroll();
  };

  // ── 거울 줄 그리기 ──
  const mirror = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let pos = 0;
    const implied = analysis.security;
    analysis.segments.forEach((s, i) => {
      if (s.start > pos) parts.push(text.slice(pos, s.start));
      let cls = 't';
      if (s.slot === 'asset' && s.asset) cls += ' chip';
      if (s.slot === 'market' && implied?.market && s.market === implied.market && s.status === 'exact') cls += ' light';
      if (s.status === 'corrected') cls += ' corr';
      else if (s.status === 'invalid' || s.status === 'unavailable' || s.status === 'nomatch') cls += ' bad';
      else if (s.status === 'choose' && s.end < text.length) cls += ' pending';
      const shown = /^[\x20-\x7e]+$/.test(s.text) ? s.text.toUpperCase() : s.text;
      parts.push(
        <span key={i} className={cls}>
          {shown}
        </span>,
      );
      pos = s.end;
    });
    if (pos < text.length) parts.push(text.slice(pos));
    return parts;
  }, [analysis, text]);

  const current = panelCanonical(panel ?? ({} as PanelState), fn);
  const placeholder = !hasText && !focused ? current || (assist === 'beginner' && !panel?.fn ? '명령 입력 — 종목코드·회사명·기능 (예: 005930, 삼성, AAPL, BTC, 차트)' : '명령 입력 · 도움말 ?') : '';

  // 지금 명령의 토큰: 마우스를 올리면 뜻, 누르면 그 토큰을 고칠 수 있게 줄에 넣어요(05 §12.5)
  const showTokens = variant === 'panel' && !focused && !hasText && !!current;
  const tokens = useMemo(() => {
    if (!showTokens) return [];
    const a = engine.analyze(current, current.length, { ...ctx, chosen: [] });
    return a.segments.map((s) => ({ seg: s, meaning: tokenMeaning(s) }));
  }, [showTokens, current, ctx]);
  const [tip, setTip] = useState<{ text: string; left: number } | null>(null);
  const editToken = (index: number) => {
    const seg = tokens[index]?.seg;
    if (!seg) return;
    setTip(null);
    writeInput(current, seg.end);
    if (seg.slot === 'security' || seg.slot === 'function' || seg.slot === 'closed') {
      // 종목·기능: 그 칸의 다른 후보 목록을 열어요(Shift+Tab과 같아요)
      setListSegment(seg.index);
      setListOpen(true);
      setDismissed(false);
    } else {
      // 시장·자산군: 그 토큰을 골라 두어서 바로 다시 칠 수 있게 해요
      inputRef.current?.setSelectionRange(seg.start, seg.end);
    }
  };
  const label = !hasText ? (focused && assist === 'beginner' ? '⏎ 시작 목록' : '') : analysis.label;
  const labelText = variant === 'panel' && fieldRef.current && fieldRef.current.clientWidth < 220 ? shortenLabel(label) : label;
  const chip = analysis.contextChip ? `[${analysis.contextChip} ›]` : '';

  return (
    <div className="cmd" onMouseDown={(e) => e.stopPropagation()}>
      {chip && hasText && <span className="cmd-chip">{chip}</span>}
      <div className={`cmd-field ${composing ? 'composing' : ''}`} ref={fieldRef}>
        <div className="cmd-mirror" ref={mirrorRef} aria-hidden="true">
          {hasText ? mirror : <span className="placeholder">{placeholder}</span>}
          {ghost && !composing && (
            <span className={`ghost ${ghost.confirmed ? '' : 'cand'}`}>
              <span className="ghost-tab">{ghost.replace ? ` ⇥ ${ghost.tab}` : ghost.tab}</span>
              {ghost.rest && <span className="ghost-rest">¦{ghost.rest}</span>}
            </span>
          )}
        </div>
        {showTokens && tokens.length > 0 && (
          <div className="cmd-tokens" onMouseLeave={() => setTip(null)}>
            {tokens.map(({ seg, meaning }, i) => (
              <span key={i}>
                {i > 0 && ' '}
                <span
                  className="tok"
                  onMouseEnter={(e) => {
                    const box = fieldRef.current?.getBoundingClientRect();
                    const r = e.currentTarget.getBoundingClientRect();
                    setTip({ text: meaning, left: box ? r.left - box.left : 0 });
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editToken(i);
                  }}
                >
                  {current.slice(seg.start, seg.end)}
                </span>
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showList}
          aria-controls="ac-list"
          aria-activedescendant={showList ? `ac-${highlight}` : undefined}
          aria-label={`패널 ${panel?.num ?? ''} 커맨드 라인`}
          aria-describedby={undefined}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onKeyDown={onKeyDown}
          onInput={onInput}
          onSelect={onSelect}
          onScroll={syncScroll}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => {
            setFocused(false);
            setListOpen(false);
            setSelectedId(null);
          }}
          onPaste={() => {
            // 붙여넣기는 절대 실행하지 않아요. 목록도 열지 않아요(05 §13)
            setDismissed(true);
          }}
          onKeyUp={(e) => logIme(e.nativeEvent)}
          onCompositionUpdate={(e) => logIme(e.nativeEvent)}
          onCompositionStart={(e) => {
            logIme(e.nativeEvent);
            composingRef.current = true;
            setComposing(true);
            setHan('on');
          }}
          onCompositionEnd={(e) => {
            logIme(e.nativeEvent);
            composingRef.current = false;
            setComposing(false);
            // 진짜 keydown이 대체 시간 안에 안 오면 의도를 실행하고, 늦게 온 같은 키는 삼켜요(K3-5)
            window.setTimeout(() => {
              const it = intent.current;
              if (it && !it.used) {
                intent.current = null;
                logIme(null, `대체 시간: 진짜 키가 안 와서 의도 실행`);
                runIntent(it);
                if (it.code) swallow.current = { code: it.code, until: Date.now() + 300 };
              }
            }, 50);
          }}
        />
      </div>
      {tip && showTokens && (
        <span className="cmd-tip" style={{ left: (fieldRef.current?.offsetLeft ?? 0) + tip.left }} role="tooltip">
          {tip.text} · 눌러서 고치기
        </span>
      )}
      {han !== 'off' && <span className={`cmd-han ${han === 'unknown' ? 'unknown' : ''}`}>한</span>}
      {label && <span className={`cmd-label ${analysis.plan.kind === 'execute' ? 'exec' : ''} ${labelFlash ? 'flash' : ''}`}>{labelText}</span>}
      {variant === 'panel' && (
        <button className="icon-btn cmd-help" aria-label="도움말" title="도움말" onClick={() => openHelp('help')}>
          ?
        </button>
      )}
      {showList && anchor && inputRef.current && (
        <CandidateList
          doc={inputRef.current.ownerDocument}
          anchor={anchor}
          analysis={analysis}
          assist={assist}
          highlight={highlight}
          selectedId={selectedId}
          showDesc={desc === 'auto' ? 'auto' : desc}
          onHover={() => undefined}
          onMore={() => setExpanded(true)}
          onPick={(row, runNow) => {
            if (row.disabled) return;
            // K8: 조합 중 클릭은 음절이 안 끝났을 수 있어요. 줄 id를 기록하고, 포커스를 뺐다 돌려 음절을 마무리한 뒤 실행해요
            if (composingRef.current) {
              intent.current = { kind: runNow ? 'run' : 'click', code: '', rowId: row.id, used: false };
              logIme(null, `조합 중 클릭: ${row.id}`);
              const inp = inputRef.current;
              inp?.blur();
              inp?.focus();
              return;
            }
            if (runNow) {
              // 더블클릭: 첫 클릭이 목록을 바꿨으면(종목 → 기능 목록) 지금 줄의 Enter와 같아요
              const here = analysis.rows.some((r) => r.id === row.id);
              if (here) setSelectedId(row.id);
              doEnter(here ? row.id : null);
            } else acceptRow(row);
          }}
        />
      )}
      {idx.loading && focused && hasText && <span className="cmd-label">종목 목록 불러오는 중…</span>}
    </div>
  );
}

/** 토큰의 뜻: GP = 가격 차트, KS = 코스피 */
function tokenMeaning(s: Analysis['segments'][number]): string {
  const t = s.text.toUpperCase();
  if (s.slot === 'security' && s.inst) {
    const where = s.inst.market ? MARKET_LABEL[s.inst.market] : ASSET_LABEL[s.inst.assetClass];
    return `${t} = ${displayName(s.inst)} (${where})`;
  }
  if (s.slot === 'market' && s.market) return `${t} = 시장 ${MARKET_LABEL[s.market]}`;
  if (s.slot === 'asset' && s.asset) return `${t} = 자산군 ${ASSET_LABEL[s.asset]}`;
  if ((s.slot === 'function' || s.slot === 'closed') && s.fn) return `${t} = ${s.fn.nameKo}`;
  if (s.slot === 'arg' && s.arg) return `${t} = 시장 ${MARKET_LABEL[s.arg as keyof typeof MARKET_LABEL] ?? (s.arg === 'CRYPTO' ? '코인' : s.arg)}`;
  return t;
}

function shortenLabel(label: string): string {
  // 좁은 패널: ⏎ GP · 삼성전자
  const m = label.match(/^⏎ 실행: (.+) (\S+ 차트|세계 지수|관심종목|환율 매트릭스|코인 시세판)(?: \((\w+)\))?/);
  if (m) return `⏎ ${m[3] ?? ''} · ${m[1]}`;
  return label;
}

export { index };
