// 블룸버그식 기능 메뉴(v0.2, 06 종목만 입력하고 Enter): 그 종목에 쓸 수 있는 기능을 번호로.
// 커맨드 라인에 번호를 치고 Enter(숫자 + Enter)하거나 줄을 누르면 그 기능이 열려요.

import { canonicalSecurity, MARKET_LABEL, ASSET_LABEL, versionLabel } from '@bt/shared';
import { arrow, dirClass, fmtPct, fmtPrice } from '../format';
import { useQuote } from '../stores/feed';
import { useInstrument } from '../stores/instruments';
import { menuFunctions, upcomingFunctions } from '../stores/menu';
import { applyExecution, type PanelState } from '../stores/panels';
import { TitleBar } from './common';

export function Menu({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const q = useQuote(inst?.id);
  if (!inst) {
    return (
      <>
        <TitleBar fn="MENU" name="기능 메뉴" />
        <div className="empty-body">종목이 필요해요</div>
      </>
    );
  }
  const list = menuFunctions(inst);
  const soon = upcomingFunctions(inst);
  const open = (code: string) => applyExecution(panel.id, { kind: 'function', fn: code, instrumentId: inst.id, canonical: `${canonicalSecurity(inst)} ${code}`, notes: [] });
  return (
    <>
      <TitleBar fn="MENU" name="기능 메뉴" sub={`${inst.nameKo || inst.nameEn || inst.code} ${inst.code}`} fresh={q?.fresh} inst={inst} />
      <div className="pbody">
        <div className="des-head">
          <div className="des-title">
            <span className="des-name">{inst.nameKo || inst.nameEn || inst.code}</span>
            <span className="cd">
              {inst.code} · {inst.market ? MARKET_LABEL[inst.market] : ASSET_LABEL[inst.assetClass]}
            </span>
          </div>
          <div className="des-price">
            <span className="des-last num">{fmtPrice(inst, q?.last)}</span>
            <span className={`num ${dirClass(q?.changePct)}`}>
              {arrow(q?.changePct)}
              {q?.changePct !== undefined ? fmtPct(Math.abs(q.changePct)).replace('+', '') : ''}
            </span>
          </div>
        </div>
        <div className="grp">
          <span>기능 · 번호를 치고 Enter</span>
        </div>
        {list.map((f, i) => (
          <div key={f.code} className="row menu-row" onClick={() => open(f.code)}>
            <span className="menu-no num">{i + 1})</span>
            <span className="menu-code">{f.code}</span>
            <span className="menu-name">{f.nameKo}</span>
            <span className="label menu-sum">{f.summary}</span>
          </div>
        ))}
        {soon.length > 0 && (
          <>
            <div className="grp">
              <span>앞으로 생길 기능</span>
            </div>
            {soon.map((f) => (
              <div key={f.code} className="row menu-row nolink" style={{ opacity: 0.5 }}>
                <span className="menu-no" />
                <span className="menu-code">{f.code}</span>
                <span className="menu-name">{f.nameKo}</span>
                <span className="label menu-sum">{versionLabel(f.version)}에서 제공 예정</span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
