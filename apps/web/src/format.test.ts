import { describe, expect, it } from 'vitest';
import { fmtBig, fmtShares, josa } from './format';

describe('조사', () => {
  it('받침에 맞춰 은/는을 붙이고, 한글로 끝나지 않으면 두 형태를 함께 적어요', () => {
    expect(josa('코스피', '은', '는')).toBe('코스피는');
    expect(josa('셀트리온', '은', '는')).toBe('셀트리온은');
    expect(josa('AAPL', '은', '는')).toBe('AAPL은(는)');
    expect(josa('', '은', '는')).toBe('은(는)');
  });
});

describe('큰 금액·주식 수', () => {
  it('원화는 조·억, 달러는 B·T, 손실은 −', () => {
    expect(fmtBig(1_338_797_800_000_000, 'KRW')).toBe('1,338.80조');
    expect(fmtBig(87_900_000_000, 'KRW')).toBe('879억');
    expect(fmtBig(-39_000_000_000, 'KRW')).toBe('−390억');
    expect(fmtBig(3_444_454_519_000, 'USD')).toBe('3.44T');
  });
  it('주식 수는 억·만 주', () => {
    expect(fmtShares(5_846_278_000)).toBe('58.46억 주');
    expect(fmtShares(35_532_000)).toBe('3,553만 주');
    expect(fmtShares(undefined)).toBe('—');
  });
});
