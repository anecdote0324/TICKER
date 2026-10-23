// 후보 목록과 설명 창(05 §4.5, §4.6)

import { createPortal } from 'react-dom';
import type { Analysis, Range, Row } from '@bt/command';
import { ASSET_LABEL, FUNCTIONS, MARKET_LABEL, versionLabel, type AssistLevel } from '@bt/shared';
import { shortcutLabel } from '../keys';
import { feedStatus } from '../stores/feed';
import { FUNCTION_SLOT_COST, kisSlots } from '../stores/slots';
import { useStore } from '../stores/store';
import { getInstrument } from '../stores/instruments';
import { appState, updateState } from '../stores/state';
import { showToast } from '../stores/ui';

interface Props {
  doc: Document;
  anchor: DOMRect;
  analysis: Analysis;
  assist: AssistLevel;
  highlight: number;
  selectedId: string | null;
  showDesc: 'auto' | 'card' | 'syntax' | 'none';
  onPick: (row: Row, run: boolean) => void;
  onHover: (i: number) => void;
  onMore: () => void;
}

function Marked({ text, ranges }: { text: string; ranges?: Range[] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let pos = 0;
  ranges
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((r, i) => {
      if (r.start > pos) out.push(text.slice(pos, r.start));
      out.push(
        <span className="m" key={i}>
          {text.slice(r.start, r.end)}
        </span>,
      );
      pos = Math.max(pos, r.end);
    });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}

function badgeClass(row: Row) {
  if (row.kind === 'function' || row.kind === 'unavailable') return 'fn';
  if (row.kind === 'security' || row.kind === 'asset') return 'asset';
  return 'gray';
}

/** 더블클릭은 첫 클릭 때 잡은 줄로 처리해요(첫 클릭이 목록을 바꾸기 때문, 05 §8.1 K8) */
let firstClick: { row: Row; at: number } | null = null;

export function CandidateList(p: Props) {
  const { analysis: a, assist } = p;
  const rows = a.rows;
  const win = p.doc.defaultView!;
  const below = win.innerHeight - p.anchor.bottom;
  const up = below < 260 && p.anchor.top > below;
  const left = Math.max(4, Math.min(p.anchor.left, win.innerWidth - 380));
  const style: React.CSSProperties = up ? { left, bottom: win.innerHeight - p.anchor.top + 2 } : { left, top: p.anchor.bottom + 2 };
  const showDescPane = p.showDesc === 'card' || p.showDesc === 'syntax' || (p.showDesc === 'auto' && assist === 'beginner' && win.innerWidth - left - 720 > 280);
  const hl = rows[p.highlight];
  const full = assist === 'beginner' || assist === 'standard';
  const wide = win.innerWidth - left > 900;

  return createPortal(
    <div className="ac" style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="ac-list" role="listbox" id="ac-list">
        {rows.map((row, i) =>
          row.kind === 'header' ? (
            <div key={row.id} className="ac-row hdr">
              {row.name}
            </div>
          ) : (
            <div
              key={row.id}
              id={`ac-${i}`}
              role="option"
              aria-selected={i === p.highlight}
              className={`ac-row ${i === p.highlight ? 'hl' : ''} ${row.id === p.selectedId ? 'sel' : ''} ${row.disabled ? 'dis' : ''}`}
              onMouseEnter={() => p.onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (e.detail >= 2 && firstClick && Date.now() - firstClick.at < 800) p.onPick(firstClick.row, true);
                else {
                  firstClick = { row, at: Date.now() };
                  p.onPick(row, false);
                }
              }}
            >
              <span className="ac-mark">{row.id === p.selectedId ? '▶' : i === p.highlight ? '▸' : ''}</span>
              {row.badge && <span className={`ac-badge ${badgeClass(row)}`}>{row.badge}</span>}
              {row.kind === 'history' ? (
                <span className="ac-code" style={{ width: 'auto' }}>
                  {row.canonical}
                </span>
              ) : (
                <>
                  {row.code && (
                    <span className="ac-code">
                      <Marked text={row.code} ranges={row.codeRanges} />
                    </span>
                  )}
                  <span className={`ac-name ${row.child ? 'child' : ''}`}>
                    <Marked text={row.name} ranges={row.nameRanges} />
                  </span>
                  {wide && row.nameEn && assist !== 'off' && <span className="ac-en">{row.nameEn}</span>}
                  {(full || row.kind !== 'function') && row.info && <span className="ac-info">{row.info}</span>}
                  {row.flags.map((f) => (
                    <span key={f} className="ac-flag">
                      {f}
                    </span>
                  ))}
                  {row.current && <span className="ac-info">● 현재</span>}
                  {row.remembered && <span className="ac-info">↺</span>}
                  <span className="ac-canon">{row.canonical}</span>
                  {row.id === p.selectedId && <span className="m">⏎</span>}
                </>
              )}
            </div>
          ),
        )}
        {a.more > 0 && (
          <div className="ac-more" onMouseDown={(e) => (e.preventDefault(), p.onMore())}>
            더 보기 (+{a.more})
          </div>
        )}
        {(full || a.plan.kind === 'error' || a.message.startsWith('✗') || a.segments.some((s) => s.note)) && (a.progress.some((x) => x.text) || a.message) && (
          <div className="ac-progress" aria-live="polite">
            {full &&
              a.progress.map((x) => (
                <span key={x.slot} className={x.state === 'done' ? 'done' : x.state === 'current' ? 'cur' : x.state === 'error' ? 'bad' : ''}>
                  {x.label} {x.state === 'done' ? '✓' : x.state === 'current' ? '▸' : x.state === 'error' ? '' : '·'} {x.text}
                </span>
              ))}
            {a.message && <span className="msg">{a.message}</span>}
          </div>
        )}
        {assist === 'beginner' && <div className="ac-keys">Tab 자동완성 · ↑↓ 고르기 · ⏎ 실행 · Esc 닫기 · {shortcutLabel('descCard')} 설명</div>}
      </div>
      {showDescPane && (p.showDesc === 'syntax' ? <SyntaxCard /> : hl && <DescCard row={hl} analysis={a} />)}
    </div>,
    p.doc.body,
  );
}

/** 기능을 열 때 필요한 실시간 슬롯(08 §4.1) */
function SlotLine({ cost }: { cost: string }) {
  const s = kisSlots(useStore(feedStatus, (f) => f.sources));
  return (
    <div>
      <span className="k">실시간 슬롯 </span>
      {cost}
      <span className="k">{s ? ` · 지금 ${s.used}/${s.limit} 사용${s.overflow ? `, ${s.overflow}개는 조회` : ''}` : ' · 한국투자증권을 연결하면 써요'}</span>
    </div>
  );
}

/** 겹침 기본값(05 §7.4): 정확히 같은 코드가 여러 종목일 때, 이 줄을 그 입력의 기본값으로 정해요 */
function DefaultButton({ row, analysis }: { row: Row; analysis: Analysis }) {
  const chosen = useStore(appState, (s) => s.defaults.chosen);
  const seg = analysis.segments[analysis.listSegment];
  if (!seg || seg.slot !== 'security' || !row.instrumentId || row.tier > 1) return null;
  if (seg.chooseReason !== 'ambiguous' && !seg.byUserDefault) return null;
  const key = seg.text.toUpperCase();
  const isDefault = chosen[key] === row.instrumentId;
  const inst = getInstrument(row.instrumentId);
  const label = `${inst?.code} ${inst?.market ?? inst?.assetClass}(${inst?.nameKo ?? inst?.nameEn ?? ''})`;
  return (
    <div style={{ marginTop: 6 }}>
      {isDefault ? (
        <>
          <span className="k">↺ 내가 정한 기본값 · </span>
          <button
            className="btn"
            style={{ height: 20, fontSize: 11 }}
            onClick={() =>
              updateState('defaults', (d) => {
                const c = { ...d.chosen };
                delete c[key];
                return { ...d, chosen: c };
              })
            }
          >
            기본값 지우기
          </button>
        </>
      ) : (
        <button
          className="btn"
          style={{ height: 20, fontSize: 11 }}
          title={`${key}⏎를 이 종목으로 열어요`}
          onClick={() => {
            const prev = appState.get().defaults.chosen[key];
            updateState('defaults', (d) => ({ ...d, chosen: { ...d.chosen, [key]: row.instrumentId! } }));
            showToast(`이제 ${key}⏎는 ${label}로 열려요`, {
              label: '되돌리기',
              run: () =>
                updateState('defaults', (d) => {
                  const c = { ...d.chosen };
                  if (prev) c[key] = prev;
                  else delete c[key];
                  return { ...d, chosen: c };
                }),
            });
          }}
        >
          기본값으로
        </button>
      )}
    </div>
  );
}

export function DescCard({ row, analysis }: { row: Row; analysis?: Analysis }) {
  if (row.kind === 'security' && row.instrumentId) {
    const inst = getInstrument(row.instrumentId);
    if (!inst) return null;
    const usable = FUNCTIONS.filter((f) => f.implemented && f.security === 'one' && f.assetClasses.includes(inst.assetClass)).map((f) => f.code);
    return (
      <div className="ac-desc">
        <h4>
          {inst.nameKo ?? inst.nameEn ?? inst.code} <span className="k">{inst.code}</span>
        </h4>
        {inst.nameKo && inst.nameEn && <div className="k">{inst.nameEn}</div>}
        <div>
          <span className="k">자산군 </span>
          {inst.assetClass} {ASSET_LABEL[inst.assetClass]}
          {inst.market && (
            <>
              {' · '}
              <span className="k">시장 </span>
              {inst.market} {MARKET_LABEL[inst.market]}
            </>
          )}
        </div>
        {inst.flags && inst.flags.length > 0 && (
          <div>
            <span className="k">표시 </span>
            {inst.flags.join(' · ')}
          </div>
        )}
        {inst.commonId && (
          <div>
            <span className="k">헷갈리기 쉬운 종목 </span>
            {getInstrument(inst.commonId)?.nameKo} (보통주)
          </div>
        )}
        <div>
          <span className="k">쓸 수 있는 기능 </span>
          <code>{usable.join(' ')}</code>
        </div>
        <div className="k">Tab: 채우기 · ⏎: {row.id ? '선택 또는 실행' : ''}</div>
        {analysis && <DefaultButton row={row} analysis={analysis} />}
      </div>
    );
  }
  if ((row.kind === 'function' || row.kind === 'unavailable') && row.fnCode) {
    const fn = FUNCTIONS.find((f) => f.code === row.fnCode);
    if (!fn) return null;
    return (
      <div className="ac-desc">
        <h4>
          <code>{fn.code}</code> {fn.nameKo} {fn.notBloomberg && <span className="k">(블룸버그 코드 아님)</span>}
        </h4>
        <div>{fn.detail ?? fn.summary}</div>
        <div>
          <span className="k">종목 </span>
          {fn.security === 'one' ? '필요' : fn.security === 'optional' ? '선택' : '필요 없음'}
          {fn.assetClasses.length > 0 && ` · ${fn.assetClasses.map((x) => ASSET_LABEL[x]).join('·')}`}
        </div>
        <div>
          <span className="k">데이터 속도 </span>
          {fn.speed}
        </div>
        {fn.implemented && FUNCTION_SLOT_COST[fn.code] && <SlotLine cost={FUNCTION_SLOT_COST[fn.code]} />}
        {!fn.implemented && (
          <div>
            <span className="k">제공 </span>
            {versionLabel(fn.version)}
          </div>
        )}
        {fn.examples.length > 0 && (
          <div>
            <span className="k">예 </span>
            {fn.examples.map((x) => (
              <code key={x}>{x} ⏎ </code>
            ))}
          </div>
        )}
        {fn.aliases && fn.aliases.length > 0 && (
          <div>
            <span className="k">별칭 </span>
            {fn.aliases.join(' ')}
          </div>
        )}
      </div>
    );
  }
  if (row.kind === 'convert' || row.flags.includes('한/영') || row.flags.includes('영→한')) {
    return (
      <div className="ac-desc">
        <h4>한/영 변환</h4>
        <div>한글 모드로 영문을 쳤거나, 영문 모드로 한글을 친 것 같아요. Tab을 누르면 바꿔 넣어요.</div>
      </div>
    );
  }
  if (row.kind === 'fix') {
    return (
      <div className="ac-desc">
        <h4>고침</h4>
        <div>{row.name}</div>
        <div className="k">Tab으로 적용해요</div>
      </div>
    );
  }
  return null;
}

export function SyntaxCard() {
  return (
    <div className="ac-desc" style={{ width: 420 }}>
      <h4>명령 문법</h4>
      <pre style={{ font: '11px var(--mono)', margin: 0, whiteSpace: 'pre' }}>{`[종목]  [시장] [자산군] [기능] ⏎
005930  KS     EQUITY   GP     ⏎  삼성전자 가격 차트
AAPL    US     EQUITY   GIP    ⏎  애플 장중 차트
BTC     –      CRYPTO   GP     ⏎  비트코인(USDT) 가격 차트
–       –      –        WEI    ⏎  세계 지수 (종목 불필요)`}</pre>
      <div>
        <span className="k">자산군 </span>EQUITY 주식 · CRYPTO 코인 · CURNCY 환율 · INDEX 지수 (EQ · CRY · CUR · IDX)
      </div>
      <div>
        <span className="k">시장 </span>KS 코스피 · KQ 코스닥 · US 미국
      </div>
      <div>
        <span className="k">키 </span>Tab 자동완성 · ↑↓ 고르기 · ⏎ 실행 · Esc 닫기 · {shortcutLabel('descCard')} 설명 · ↑(빈 줄) 이전 명령
      </div>
      <div className="k">Tab으로 받아들이는 것은 접근성 가이드(APG)의 콤보박스 규칙과 일부러 다르게 정했어요.</div>
    </div>
  );
}
