// 시세 흐름 띠: 주요 지수, 환율, 코인. 실시간이 아닌 항목에는 짧은 신선도 배지(02).

import { arrow, dirClass, fmtPct, fmtPrice } from '../format';
import { useQuotes } from '../stores/feed';
import { getInstrument } from '../stores/instruments';
import { FreshBadge } from './FreshBadge';

const IDS = ['IDX:KOSPI', 'IDX:KOSDAQ', 'IDX:SPX', 'IDX:CCMP', 'IDX:NKY', 'IDX:HSI', 'IDX:DAX', 'CUR:USDKRW', 'CUR:JPYKRW', 'CUR:EURKRW', 'CRY:BTC', 'CRY:ETH', 'CRY:XRP', 'CRY:SOL'];

export function TickerTape() {
  const quotes = useQuotes(IDS);
  const items = IDS.map((id) => ({ inst: getInstrument(id), q: quotes.get(id) })).filter((x) => x.inst);
  const render = (k: string) =>
    items.map(({ inst, q }) => (
      <span key={`${k}${inst!.id}`} className="tape-item">
        <b>{inst!.nameKo ?? inst!.code}</b>
        <span style={{ color: 'var(--value-hi)' }}>{fmtPrice(inst, q?.last)}</span>{' '}
        <span className={dirClass(q?.changePct)}>
          {arrow(q?.changePct)}
          {q?.changePct !== undefined ? fmtPct(Math.abs(q.changePct)).replace('+', '') : ''}
        </span>{' '}
        <FreshBadge fresh={q?.fresh} inst={inst} variant="short" />
      </span>
    ));
  return (
    <div className="tape" aria-label="시세 흐름 띠">
      <div className="tape-track">
        {render('a')}
        {render('b')}
      </div>
    </div>
  );
}
