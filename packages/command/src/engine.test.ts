// 05 커맨드 라인 문서의 걸어 보기 예시(§5)와 예외 상황(§13)을 테스트로 옮겼어요.

import { describe, expect, it } from 'vitest';
import type { Instrument } from '@bt/shared';
import { CommandEngine } from './engine';
import { fixtureInstruments } from './fixtures';
import { SearchIndex } from './search-index';
import type { Analysis, EngineContext } from './types';

const index = new SearchIndex(fixtureInstruments());
const engine = new CommandEngine(index);
const inst = (id: string) => index.get(id)!.inst as Instrument;

function ctx(panel: EngineContext['panel'] = {}, extra: Partial<EngineContext> = {}): EngineContext {
  return { panel, assist: 'beginner', hanEng: true, tabAutofill: true, ...extra };
}

function run(input: string, c: EngineContext = ctx(), composing = false): Analysis {
  return engine.analyze(input, input.length, c, { composing });
}

/** Tab: 강조된 1번 줄로 채우기 */
function tab(a: Analysis, c: EngineContext = ctx()) {
  const row = a.rows.find((r) => !r.disabled && r.kind !== 'header')!;
  return engine.applyRow(a, row, c);
}

/** Enter 두 번: 첫 Enter가 선택이면 두 번째 Enter가 그 줄을 받아들여요 */
function enterTwice(input: string, c: EngineContext = ctx()) {
  const a = run(input, c);
  const first = engine.enter(a, c);
  if (first.kind !== 'select') return first;
  const a2 = engine.analyze(input, input.length, c, { listSegment: first.segment });
  return engine.enter(a2, c, first.rowId);
}

describe('(a) 0059 → Tab → G → Tab → Enter', () => {
  it('코드 앞부분은 후보 흐린 글씨, Enter는 선택만', () => {
    const a = run('0059');
    expect(a.rows[0].id).toBe('sec:EQ:KS:005930');
    expect(a.rows[1].id).toBe('sec:EQ:KS:005935'); // 우선주는 보통주 바로 아래
    expect(a.rows[1].child).toBe(true);
    expect(a.plan.kind).toBe('select');
    expect(a.label).toBe('⏎ 선택: 005930 삼성전자');
    expect(a.ghost).toMatchObject({ tab: '30 KS EQUITY', rest: ' GP', confirmed: false });
  });

  it('Tab은 시장·자산군을 연하게 채우고, 빈 패널이라 GP가 함축돼요', () => {
    const t = tab(run('0059'));
    expect(t.input).toBe('005930 KS EQUITY ');
    const a = run(t.input);
    expect(a.plan.kind).toBe('execute');
    expect(a.rows.map((r) => r.code).slice(0, 2)).toEqual(['GP', 'GIP']);
    expect(a.ghost).toMatchObject({ tab: 'GP', confirmed: true });
    expect(a.label).toBe('⏎ 실행: 삼성전자 가격 차트 (GP)');
  });

  it('G는 v0.1에서 앞부분일 뿐이라 GP를 선택만 해요', () => {
    const a = run('005930 KS EQUITY G');
    expect(a.plan.kind).toBe('select');
    expect(a.label).toBe('⏎ 선택: GP 가격 차트');
    expect(a.ghost).toMatchObject({ tab: 'P', confirmed: false });
    const t = tab(a);
    expect(t.input).toBe('005930 KS EQUITY GP');
    expect(t.closeList).toBe(true);
    const done = run(t.input);
    expect(done.plan).toMatchObject({ kind: 'execute', exec: { canonical: '005930 KS EQUITY GP', fn: 'GP' } });
  });

  it('0059⏎⏎ 도 같은 결과', () => {
    expect(enterTwice('0059')).toMatchObject({ kind: 'execute', exec: { canonical: '005930 KS EQUITY GP' } });
  });

  it('005930⏎ 은 한 번에 실행', () => {
    expect(run('005930').plan).toMatchObject({ kind: 'execute', exec: { canonical: '005930 KS EQUITY GP' } });
  });
});

describe('(b) 삼성', () => {
  it('이름 앞부분: 삼성전자, 바로 아래 우선주, 선택만', () => {
    const a = run('삼성');
    expect(a.rows[0].code).toBe('005930');
    expect(a.rows[1].code).toBe('005935');
    expect(a.plan.kind).toBe('select');
  });
  it('조합 중에는 흐린 글씨를 숨겨요', () => {
    expect(run('삼성', ctx(), true).ghost).toBeNull();
  });
  it('삼성저(조합 중)도 자모 앞부분으로 찾아요', () => {
    const a = run('삼성저', ctx(), true);
    expect(a.rows[0].code).toBe('005930');
  });
  it('삼성전자는 정확한 이름이라 실행', () => {
    expect(run('삼성전자').plan.kind).toBe('execute');
  });
});

describe('(c) 초성', () => {
  it('ㅅㅅㅈㅈ: 초성 전체 일치가 먼저, 늘 선택만', () => {
    const a = run('ㅅㅅㅈㅈ');
    expect(a.rows[0].code).toBe('005930');
    expect(a.rows[1].code).toBe('005935');
    expect(a.plan.kind).toBe('select');
  });
  it('겹자음은 나눠서 찾아요', () => {
    expect(run('ㅅㅅㅈㅈ').rows.length).toBeGreaterThan(0);
  });
});

describe('(d) 한글 모드로 친 GP', () => {
  it('종목 뒤 헤 → GP 는 실행', () => {
    const a = run('005930 KS EQUITY 헤');
    expect(a.plan).toMatchObject({ kind: 'execute', exec: { fn: 'GP' } });
    expect(a.label).toBe('⏎ 실행: 삼성전자 가격 차트 (헤 → GP)');
  });
  it('첫 단어 헤는 이름 검색이 먼저, 변환 줄은 상위 2줄 안, 선택만', () => {
    const a = run('헤', ctx({ security: inst('EQ:US:AAPL'), fn: 'GP' }));
    expect(a.plan.kind).toBe('select');
    const ids = a.rows.slice(0, 2).map((r) => r.id);
    expect(ids).toContain('sec:EQ:KQ:084990');
    expect(ids).toContain('fn:GP');
  });
});

describe('시장까지 다 친 줄', () => {
  it("AAPL US: 목록에 '일치 없음' 대신 알아들은 시장 줄이 나와요", () => {
    const a = run('AAPL US');
    expect(a.plan.kind).toBe('execute');
    expect(a.rows[0]).toMatchObject({ id: 'mkt:US', name: '미국', disabled: true });
    expect(a.rows.some((r) => r.kind === 'nomatch')).toBe(false);
  });
});

describe('(e) 종목 없이 GP', () => {
  const aapl = ctx({ security: inst('EQ:US:AAPL'), fn: 'GIP' });
  it('2글자 정확한 기능 코드는 바로 실행, 같은 글자 종목은 2번 줄', () => {
    const a = run('GP', aapl);
    expect(a.plan).toMatchObject({ kind: 'execute', exec: { fn: 'GP', instrumentId: 'EQ:US:AAPL' } });
    expect(a.label).toBe('⏎ 실행: AAPL 가격 차트 (GP)');
    expect(a.rows[0].id).toBe('fn:GP');
    expect(a.rows[1].id).toBe('sec:EQ:US:GP');
    expect(a.contextChip).toBe('AAPL US');
  });
  it('G 한 글자는 GP를 선택만', () => {
    const a = run('G', aapl);
    expect(a.plan).toMatchObject({ kind: 'select', rowId: 'fn:GP' });
  });
  it('띄운 종목이 없으면 종목 필요', () => {
    expect(run('GP').plan.kind).toBe('need-security');
    expect(run('GP').label).toBe('⏎ 종목 필요: GP에 쓸 종목을 입력하세요');
  });
  it('GP US 는 종목', () => {
    expect(run('GP US').plan).toMatchObject({ kind: 'execute', exec: { instrumentId: 'EQ:US:GP' } });
  });
  it('기능 먼저 쓰고 종목: GP 005930', () => {
    expect(run('GP 005930').plan).toMatchObject({ kind: 'execute', exec: { canonical: '005930 KS EQUITY GP' } });
  });
});

describe('(f) BTC', () => {
  const sam = ctx({ security: inst('EQ:KS:005930'), fn: 'GP' });
  it('덮어쓰기 표로 코인, 흐린 글씨는 확정', () => {
    const a = run('BTC', sam);
    expect(a.plan).toMatchObject({ kind: 'execute', exec: { canonical: 'BTC CRYPTO GP' } });
    expect(a.label).toBe('⏎ 실행: 비트코인(BTC/USDT) 가격 차트 (GP)');
    expect(a.ghost).toMatchObject({ tab: ' CRYPTO', rest: ' GP', confirmed: true });
    expect(a.rows[1].id).toBe('sec:EQ:US:BTC');
  });
  it('BTC US, BTC EQ 는 ETF', () => {
    expect(run('BTC US', sam).plan).toMatchObject({ exec: { instrumentId: 'EQ:US:BTC' } });
    expect(run('BTC EQ', sam).plan).toMatchObject({ exec: { instrumentId: 'EQ:US:BTC' } });
  });
  it('비트코인, btcusdt, btc/usdt 는 BTC CRYPTO', () => {
    for (const s of ['비트코인', 'btcusdt', 'btc/usdt']) expect(run(s, sam).plan).toMatchObject({ exec: { instrumentId: 'CRY:BTC' } });
  });
  it('ETHBTC 는 USDT 마켓만 안내, 고침 줄이 1번', () => {
    const a = run('ETHBTC', sam);
    expect(a.plan.kind).toBe('error');
    expect(a.rows[0]).toMatchObject({ kind: 'fix', replaceLine: 'ETH CRYPTO' });
  });
  it('CVX 는 겹침이라 두 줄 모두, 선택만', () => {
    const a = run('CVX', sam);
    expect(a.plan.kind).toBe('select');
    expect(a.rows.map((r) => r.id)).toEqual(expect.arrayContaining(['sec:EQ:US:CVX', 'sec:CRY:CVX']));
  });
  it('사용자가 정한 기본값이 있으면 실행', () => {
    const c = ctx({}, { userDefault: (k) => (k === 'CVX' ? 'CRY:CVX' : undefined) });
    const a = run('CVX', c);
    expect(a.plan).toMatchObject({ kind: 'execute', exec: { instrumentId: 'CRY:CVX' } });
    expect(a.label).toContain('내가 정한 기본값 ↺');
  });
  it('C 한 글자는 선택만', () => {
    expect(run('C', sam).plan.kind).toBe('select');
  });
  it('USDT만 치면 안내', () => {
    expect(run('USDT').plan).toMatchObject({ kind: 'error' });
  });
});

describe('(g) WEI', () => {
  const aapl = ctx({ security: inst('EQ:US:AAPL'), fn: 'GP' });
  it('3글자 정확한 기능 코드는 바로 실행', () => {
    const a = run('WEI', aapl);
    expect(a.plan).toMatchObject({ kind: 'execute', exec: { fn: 'WEI', canonical: 'WEI' } });
    expect(a.label).toBe('⏎ 실행: 세계 지수 (종목 불필요)');
  });
  it('지수⏎ 는 정확한 키워드', () => {
    expect(run('지수', aapl).plan).toMatchObject({ kind: 'execute', exec: { fn: 'WEI' } });
  });
  it('005930 WEI 는 WEI 실행, 005930을 띄운 종목으로', () => {
    expect(run('005930 WEI').plan).toMatchObject({ kind: 'execute', exec: { fn: 'WEI', instrumentId: 'EQ:KS:005930', setsSecurityOnly: true } });
  });
  it('ㅈ댜 는 변환 줄이 상위 2줄 안, 선택만', () => {
    const a = run('ㅈ댜', aapl);
    expect(a.plan.kind).toBe('select');
    expect(a.rows.slice(0, 2).map((r) => r.id)).toContain('fn:WEI');
  });
});

describe('겹침과 예외(§7, §13)', () => {
  it('FXC 는 기능, FXC US 는 종목', () => {
    expect(run('FXC').plan).toMatchObject({ exec: { fn: 'FXC' } });
    expect(run('FXC US').plan).toMatchObject({ exec: { instrumentId: 'EQ:US:FXC' } });
  });
  it('HELP 는 도움말, HELP US 는 종목', () => {
    expect(run('HELP').plan).toMatchObject({ exec: { kind: 'command', cmd: 'help' } });
    expect(run('HELP US').plan).toMatchObject({ exec: { instrumentId: 'EQ:US:HELP' } });
  });
  it('설정·PDF·? 명령', () => {
    expect(run('설정').plan).toMatchObject({ exec: { cmd: 'settings' } });
    expect(run('PDF').plan).toMatchObject({ exec: { cmd: 'settings' } });
    expect(run('?').plan).toMatchObject({ exec: { cmd: 'syntax' } });
  });
  it('아직 만들지 않은 기능(ECO)은 실행 안 됨', () => {
    const a = run('ECO');
    expect(a.plan.kind).toBe('error');
    expect(a.label).toContain('v0.3에서 제공 예정');
  });
  it('DES 는 v0.2부터 종목을 물어요(빈 패널)', () => {
    const a = run('DES');
    expect(a.plan.kind).not.toBe('error');
    expect(a.label).toMatch(/종목 필요/);
  });
  it('GS KS 는 코스피의 GS, 골드만삭스가 아니에요', () => {
    expect(run('GS KS').plan).toMatchObject({ exec: { instrumentId: 'EQ:KS:078930' } });
  });
  it('GS 는 짧은 입력이라 선택만', () => {
    expect(run('GS').plan.kind).toBe('select');
  });
  it('005930 KQ 는 KS로 교정해서 실행', () => {
    const a = run('005930 KQ');
    expect(a.plan).toMatchObject({ kind: 'execute', exec: { canonical: '005930 KS EQUITY GP' } });
    expect(a.label).toContain('KQ → KS');
  });
  it('틀린 자산군은 고침 줄', () => {
    const a = run('005930 CRYPTO');
    expect(a.plan.kind).toBe('error');
    expect(a.rows[0]).toMatchObject({ kind: 'fix', replaceLine: '005930 KS EQUITY' });
  });
  it('지원하지 않는 시장', () => {
    const a = run('005930 LN');
    expect(a.plan).toMatchObject({ kind: 'error', message: '지원하지 않는 시장이에요 (KS·KQ·US만)' });
  });
  it('기능 두 개', () => {
    expect(run('005930 GP GIP').plan).toMatchObject({ kind: 'error', message: '기능은 하나만 쓸 수 있어요' });
  });
  it('끝의 GO 와 꺾쇠를 지워요', () => {
    expect(run('005930 KS <EQUITY> GP <GO>').plan).toMatchObject({ kind: 'execute', exec: { canonical: '005930 KS EQUITY GP' } });
  });
  it('자산군의 대표 기능', () => {
    expect(run('CRYPTO').plan).toMatchObject({ exec: { fn: 'CRYP' } });
    expect(run('CURNCY').plan).toMatchObject({ exec: { fn: 'FXC' } });
    expect(run('INDEX').plan).toMatchObject({ exec: { fn: 'WEI' } });
    expect(run('EQUITY').plan).toMatchObject({ exec: { kind: 'asset-list', asset: 'EQUITY' } });
  });
  it('통화 코드 하나', () => {
    expect(run('EUR').plan).toMatchObject({ exec: { instrumentId: 'CUR:EURKRW' } });
    expect(run('KRW').plan).toMatchObject({ exec: { instrumentId: 'CUR:USDKRW' } });
    expect(run('USD').plan).toMatchObject({ exec: { instrumentId: 'CUR:USDKRW' } });
  });
  it('거꾸로 된 환율', () => {
    const a = run('KRWUSD');
    expect(a.plan).toMatchObject({ exec: { instrumentId: 'CUR:USDKRW' } });
  });
  it('원달러 키워드', () => {
    expect(run('원달러').plan).toMatchObject({ exec: { instrumentId: 'CUR:USDKRW' } });
  });
  it('미국 클래스 주식 표기', () => {
    expect(run('BRK.B').plan).toMatchObject({ exec: { instrumentId: 'EQ:US:BRK/B' } });
    expect(run('BRK-B').plan).toMatchObject({ exec: { instrumentId: 'EQ:US:BRK/B' } });
  });
  it('여러 단어 이름', () => {
    expect(run('equity residential').plan).toMatchObject({ exec: { instrumentId: 'EQ:US:EQR' } });
  });
  it('앞자리 0이 빠진 코드는 T7, 선택만', () => {
    const a = run('5930');
    expect(a.rows[0].code).toBe('005930');
    expect(a.plan.kind).toBe('select');
  });
  it('ㅁ메ㅣ 는 변환 줄 AAPL, 선택만', () => {
    const a = run('ㅁ메ㅣ');
    expect(a.plan.kind).toBe('select');
    expect(a.rows.slice(0, 2).map((r) => r.id)).toContain('sec:EQ:US:AAPL');
  });
  it('tkatjd 는 영→한 줄', () => {
    const a = run('tkatjd');
    const row = a.rows.find((r) => r.code === '005930');
    expect(row?.flags).toContain('영→한');
  });
  it('지금 기능 유지: GIP를 보던 패널에서 005930⏎', () => {
    const c = ctx({ security: inst('EQ:US:AAPL'), fn: 'GIP' });
    expect(run('005930', c).plan).toMatchObject({ exec: { canonical: '005930 KS EQUITY GIP' } });
    const w = ctx({ fn: 'WEI' });
    expect(run('005930', w).plan).toMatchObject({ exec: { canonical: '005930 KS EQUITY GP' } });
  });
  it('분봉이 없는 종목에는 GIP를 쓸 수 없어요', () => {
    const c = ctx({}, { supports: (fn, i) => !(fn === 'GIP' && i.assetClass === 'CURNCY') });
    expect(run('USDKRW GIP', c).plan.kind).toBe('error');
    // 지금 기능이 GIP여도 환율에는 GP
    const c2 = ctx({ fn: 'GIP' }, { supports: (fn, i) => !(fn === 'GIP' && i.assetClass === 'CURNCY') });
    expect(run('USDKRW', c2).plan).toMatchObject({ exec: { fn: 'GP' } });
  });
  it('빈 줄: 입문은 시작 목록', () => {
    const a = run('');
    expect(a.plan.kind).toBe('empty');
    expect(a.rows.some((r) => r.code === 'WEI')).toBe(true);
  });
  it('기억된 선택(↺)은 애매한 목록의 순서만 바꿔요', () => {
    const c = ctx({}, { remembered: (q) => (q === '삼성' ? 'sec:EQ:KS:207940' : undefined) });
    const a = run('삼성', c);
    expect(a.rows[0].id).toBe('sec:EQ:KS:207940');
    expect(a.rows[0].remembered).toBe(true);
    expect(a.plan.kind).toBe('select');
  });
});

describe('§4.5·§13 목록에 없는 코드는 한국투자증권에서 직접 조회', () => {
  const withKey = ctx({}, { lookup: true });

  it('키가 있으면 첫 Enter는 직접 조회 줄을 선택만, 두 번째 Enter가 조회해요(기능이 없으면 GP)', () => {
    const a = run('123456', withKey);
    expect(a.rows[0]).toMatchObject({ id: 'lookup:KR:123456', kind: 'lookup', disabled: false });
    expect(a.label).toBe('⏎ 선택: 123456 직접 조회');
    const out = enterTwice('123456', withKey);
    expect(out).toMatchObject({ kind: 'execute', exec: { kind: 'lookup', lookup: { code: '123456', market: 'KR' }, fn: 'GP' } });
  });

  it('기능을 함께 치면 그 기능으로 열어요', () => {
    expect(enterTwice('123456 GIP', withKey)).toMatchObject({ kind: 'execute', exec: { kind: 'lookup', fn: 'GIP' } });
  });

  it('미국 티커 모양도 조회해요. 시장을 붙이면 그 시장만', () => {
    expect(run('ZZZZ', withKey).rows[0].id).toBe('lookup:US:ZZZZ');
    expect(run('ZZZZ KS', withKey).rows.some((r) => r.kind === 'lookup')).toBe(false);
  });

  it('키가 없으면 일치 없음 줄 아래에 안내만(고를 수 없어요)', () => {
    const a = run('XYZQ');
    expect(a.plan.kind).toBe('nomatch');
    expect(a.rows.map((r) => r.kind)).toEqual(['nomatch', 'lookup']);
    expect(a.rows[1].disabled).toBe(true);
  });
});

describe('§3.7 뒤 단계 코드 모양은 자리만 지켜요', () => {
  it.each([
    ['KR103502G9C2', '채권 ISIN'],
    ['KMZ5', '선물 월물'],
    ['CO1', '선물 월물'],
    ['101W9000', '지수선물'],
    ['201W9340', '지수옵션'],
  ])('%s → 실행 안 됨: %s', (input, word) => {
    const a = run(input);
    expect(a.plan.kind).toBe('error');
    expect(a.label).toContain(word);
    expect(a.label).toContain('제공 예정');
  });
});

describe('§4.5 더 보기는 자산군별로 묶어요', () => {
  it('여러 자산군이 섞이면 머리줄을 붙여 묶어요', () => {
    const a = engine.analyze('C', 1, ctx(), { expanded: true });
    const headers = a.rows.filter((r) => r.kind === 'header').map((r) => r.name);
    expect(headers.length).toBeGreaterThanOrEqual(2);
    expect(headers.some((h) => h.includes('코인'))).toBe(true);
    // 머리줄 아래 종목은 모두 그 자산군이에요
    let cur = '';
    for (const r of a.rows) {
      if (r.kind === 'header') cur = r.name;
      else if (r.kind === 'security' && cur.includes('코인')) expect(r.badge).toBe('CRY');
    }
  });

  it('펼치지 않으면 묶지 않아요', () => {
    expect(run('C').rows.some((r) => r.kind === 'header' && r.name.includes('코인'))).toBe(false);
  });
});
