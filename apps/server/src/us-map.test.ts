import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appTicker, asOfDate, parseInvescoHoldings, parseSpdrHoldings, unzipEntry, UsMapService, xlsxRows } from './us-map';
import type { Logger } from './util';

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** 시험용 zip(deflate). 엑셀 파일과 같은 구조로 sharedStrings·sheet1만 넣어요 */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = Buffer.from(enc.encode(name));
    const raw = Buffer.from(enc.encode(text));
    const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, data);
    centrals.push(ch, nameB);
    offset += lh.length + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

/** SPDR 보유 종목 엑셀과 같은 모양: 위에 펀드 정보, 5번째 줄 머리줄, 현금 줄과 임시 코드 줄 */
function spdrXlsx(): Uint8Array {
  const strings = ['Fund Name:', 'SPDR S&amp;P 500 ETF', 'Holdings:', 'As of 03-Nov-2026', 'Name', 'Ticker', 'Weight', 'Sector', 'NVIDIA CORP', 'NVDA', '-', 'BERKSHIRE HATHAWAY INC CL B', 'BRK.B', 'US DOLLAR', 'CONTRA HOLOGIC', '2602335D'];
  const sst = `<?xml version="1.0"?><sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
  const s = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const n = (ref: string, v: number) => `<c r="${ref}" t="n"><v>${v}</v></c>`;
  const rows = [
    `<row r="1">${s('A1', 0)}${s('B1', 1)}</row>`,
    `<row r="3">${s('A3', 2)}${s('B3', 3)}</row>`,
    `<row r="5">${s('A5', 4)}${s('B5', 5)}${s('E5', 6)}${s('F5', 7)}</row>`,
    `<row r="6">${s('A6', 8)}${s('B6', 9)}${n('E6', 7.66)}${s('F6', 10)}</row>`,
    `<row r="7">${s('A7', 11)}${s('B7', 12)}${n('E7', 1.59)}${s('F7', 10)}</row>`,
    `<row r="8">${s('A8', 13)}${s('B8', 10)}${n('E8', 0.07)}${s('F8', 10)}</row>`,
    `<row r="9">${s('A9', 14)}${s('B9', 15)}${n('E9', 0.000003)}</row>`,
    `<row r="10"><c r="A10"/><c r="B10"/></row>`,
  ];
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
  return zip({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet });
}

describe('ETF 보유 종목 파일', () => {
  it('종목 코드는 앱 표기(BRK/B)로 바꾸고, 현금·임시 코드 줄은 빼요', () => {
    expect(appTicker('BRK.B')).toBe('BRK/B');
    expect(appTicker('bf b')).toBe('BF/B');
    expect(appTicker('NVDA')).toBe('NVDA');
    expect(appTicker('-')).toBeUndefined();
    expect(appTicker('2602335D')).toBeUndefined();
    expect(appTicker('USDPDV')).toBeUndefined();
  });

  it('기준일은 03-Nov-2026과 2026-11-03 둘 다 읽어요', () => {
    expect(asOfDate('As of 03-Nov-2026')).toBe('2026-11-03');
    expect(asOfDate('2026-11-03')).toBe('2026-11-03');
    expect(asOfDate('없음')).toBeUndefined();
  });

  it('zip에서 파일을 꺼내고, 엑셀 칸을 열 위치대로 읽어요', () => {
    const z = zip({ 'a.txt': 'hello' });
    expect(new TextDecoder().decode(unzipEntry(z, 'a.txt'))).toBe('hello');
    expect(unzipEntry(z, 'b.txt')).toBeUndefined();
    const rows = xlsxRows(spdrXlsx());
    expect(rows[2]).toEqual(['Name', 'Ticker', '', '', 'Weight', 'Sector']);
    expect(rows[0][1]).toBe('SPDR S&P 500 ETF');
  });

  it('SPDR 엑셀: 머리줄 아래의 종목과 비중, 기준일', () => {
    const r = parseSpdrHoldings(spdrXlsx());
    expect(r.etf).toBe('SPY');
    expect(r.asOf).toBe('2026-11-03');
    expect(r.holdings).toEqual([
      { ticker: 'NVDA', name: 'NVIDIA CORP', weight: 7.66 },
      { ticker: 'BRK/B', name: 'BERKSHIRE HATHAWAY INC CL B', weight: 1.59 },
    ]);
  });

  it('SPDR 엑셀에 머리줄이 없으면 알아보기 쉬운 오류', () => {
    expect(() => parseSpdrHoldings(zip({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData></sheetData></worksheet>' }))).toThrow(/머리줄/);
  });

  it('Invesco JSON: 주식과 예탁증서만, 현금·선물·담보는 빼요', () => {
    const r = parseInvescoHoldings('QQQ', {
      effectiveDate: '2026-11-03',
      holdings: [
        { ticker: 'NVDA', issuerName: 'NVIDIA Corp', percentageOfTotalNetAssets: 8.15, securityTypeCode: 'COM' },
        { ticker: 'ASML', issuerName: 'ASML Holding NV', percentageOfTotalNetAssets: 1.2, securityTypeCode: 'DRNY' },
        { ticker: 'USD', issuerName: 'US Dollar', percentageOfTotalNetAssets: 0.1, securityTypeCode: 'CURR' },
        { ticker: 'NQZ6', issuerName: 'NASDAQ 100 E-MINI', percentageOfTotalNetAssets: 0.2, securityTypeCode: 'IFUT' },
        { ticker: null, issuerName: 'Collateral', percentageOfTotalNetAssets: null, securityTypeCode: 'CURRCOL' },
      ],
    });
    expect(r.asOf).toBe('2026-11-03');
    expect(r.holdings.map((h) => h.ticker)).toEqual(['NVDA', 'ASML']);
  });
});

describe('UsMapService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('새로 받지 못하면 데이터 폴더에 둔 마지막 파일을 쓰고, 오류를 함께 알려 줘요', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usmap-'));
    writeFileSync(join(dir, 'etf-holdings-QQQ.json'), JSON.stringify({ etf: 'QQQ', asOf: '2026-10-30', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 8 }], savedAt: 0 }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const svc = new UsMapService(dir, quiet);
    const first = await svc.holdings('NDX');
    expect(first.data?.asOf).toBe('2026-10-30');
    // 받기는 뒤에서 해요. 끝난 다음 요청에는 오류가 붙어요
    await new Promise((r) => setTimeout(r, 20));
    const second = await svc.holdings('NDX');
    expect(second.data?.holdings[0].ticker).toBe('AAPL');
    expect(second.error).toMatch(/QQQ 보유 종목 파일을 받지 못했어요/);
  });

  it('처음이면 받을 때까지 기다리고, 받은 파일을 데이터 폴더에 둬요', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usmap-'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ effectiveDate: '2026-11-03', holdings: [{ ticker: 'MSFT', issuerName: 'Microsoft', percentageOfTotalNetAssets: 6.3, securityTypeCode: 'COM' }] }), { status: 200 })),
    );
    const svc = new UsMapService(dir, quiet);
    const r = await svc.holdings('NDX');
    expect(r.data?.holdings).toEqual([{ ticker: 'MSFT', name: 'Microsoft', weight: 6.3 }]);
    await new Promise((res) => setTimeout(res, 20));
    expect(JSON.parse(readFileSync(join(dir, 'etf-holdings-QQQ.json'), 'utf8')).asOf).toBe('2026-11-03');
  });

  it('업종 분류는 받는 동안 없음으로 두고, 받은 뒤에는 데이터 폴더에서도 읽어요', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usmap-'));
    const svc = new UsMapService(dir, quiet);
    let resolve!: (m: Map<string, string>) => void;
    const load = vi.fn(() => new Promise<Map<string, string>>((r) => (resolve = r)));
    expect(await svc.industryMap(load)).toBeUndefined();
    expect(svc.industryLoading).toBe(true);
    // 받는 중에는 다시 부르지 않아요
    await svc.industryMap(load);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(new Map([['NVDA', '반도체']]));
    await new Promise((r) => setTimeout(r, 20));
    expect((await svc.industryMap(load))?.get('NVDA')).toBe('반도체');
    const again = new UsMapService(dir, quiet);
    expect((await again.industryMap(load))?.get('NVDA')).toBe('반도체');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
