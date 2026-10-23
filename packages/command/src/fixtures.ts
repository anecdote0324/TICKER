// 테스트용 종목 목록. 05 걸어 보기 예시와 겹침 표(§7.7)에 나오는 종목을 담았어요.

import { staticInstruments, type Instrument } from '@bt/shared';

const kr = (code: string, nameKo: string, market: 'KS' | 'KQ', popularity: number, extra: Partial<Instrument> = {}): Instrument => ({
  id: `EQ:${market}:${code}`,
  assetClass: 'EQUITY',
  market,
  code,
  nameKo,
  exchange: 'KRX',
  currency: 'KRW',
  popularity,
  ...extra,
});

const us = (code: string, nameEn: string, popularity: number, extra: Partial<Instrument> = {}): Instrument => ({
  id: `EQ:US:${code}`,
  assetClass: 'EQUITY',
  market: 'US',
  code,
  nameEn,
  exchange: 'NAS',
  currency: 'USD',
  popularity,
  ...extra,
});

const cry = (code: string, nameKo: string | undefined, nameEn: string, popularity: number): Instrument => ({
  id: `CRY:${code}`,
  assetClass: 'CRYPTO',
  code,
  nameKo,
  nameEn,
  aliases: [`${code}USDT`],
  exchange: 'BINANCE',
  currency: 'USDT',
  feedSymbol: `${code}USDT`,
  popularity,
});

export function fixtureInstruments(): Instrument[] {
  return [
    kr('005930', '삼성전자', 'KS', 1, { nameEn: 'Samsung Electronics' }),
    kr('005935', '삼성전자우', 'KS', 0.9, { flags: ['PREF'], commonId: 'EQ:KS:005930' }),
    kr('005940', 'NH투자증권', 'KS', 0.6),
    kr('207940', '삼성바이오로직스', 'KS', 0.95),
    kr('006400', '삼성SDI', 'KS', 0.85),
    kr('000660', 'SK하이닉스', 'KS', 0.99),
    kr('078930', 'GS', 'KS', 0.7),
    kr('030200', 'KT', 'KS', 0.7),
    kr('105560', 'KB금융', 'KS', 0.8),
    kr('084990', '헬릭스미스', 'KQ', 0.3),
    kr('069500', 'KODEX 200', 'KS', 0.9, { flags: ['ETF'] }),
    us('AAPL', 'Apple Inc', 1, { nameKo: '애플' }),
    us('GP', 'GreenPower Motor Co', 0.1),
    us('GPC', 'Genuine Parts Co', 0.3, { exchange: 'NYS' }),
    us('G', 'Genpact Ltd', 0.3, { exchange: 'NYS' }),
    us('BTC', 'Grayscale Bitcoin Mini Trust', 0.4, { flags: ['ETF'], exchange: 'AMS' }),
    us('CVX', 'Chevron Corp', 0.8, { exchange: 'NYS' }),
    us('C', 'Citigroup Inc', 0.8, { exchange: 'NYS' }),
    us('W', 'Wayfair Inc', 0.3, { exchange: 'NYS' }),
    us('FXC', 'Invesco CurrencyShares Canadian Dollar Trust', 0.1, { flags: ['ETF'], exchange: 'AMS' }),
    us('DES', 'WisdomTree US SmallCap Dividend Fund', 0.1, { flags: ['ETF'], exchange: 'AMS' }),
    us('HELP', 'Helus Pharma', 0.05),
    us('GS', 'Goldman Sachs Group Inc', 0.8, { exchange: 'NYS' }),
    us('USD', 'ProShares Ultra Semiconductors', 0.1, { flags: ['ETF'], exchange: 'AMS' }),
    us('EQR', 'Equity Residential', 0.4, { exchange: 'NYS' }),
    us('BRK/B', 'Berkshire Hathaway Inc Class B', 0.9, { exchange: 'NYS', aliases: ['BRK.B'] }),
    us('KB', 'KB Financial Group Inc ADR', 0.3, { exchange: 'NYS', flags: ['ADR'] }),
    us('KT', 'KT Corp ADR', 0.3, { exchange: 'NYS', flags: ['ADR'] }),
    cry('BTC', '비트코인', 'Bitcoin', 1),
    cry('ETH', '이더리움', 'Ethereum', 0.98),
    cry('CVX', undefined, 'Convex Finance', 0.2),
    cry('G', undefined, 'Gravity', 0.1),
    cry('W', undefined, 'Wormhole', 0.2),
    cry('C', undefined, 'Chainbase', 0.1),
    ...staticInstruments(),
  ];
}
