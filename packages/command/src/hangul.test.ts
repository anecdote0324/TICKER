import { describe, expect, it } from 'vitest';
import { composeJamo, hangulToKeys, hangulToQwerty, qwertyToHangul, splitDoubleConsonants, toChosung, toKeystrokeJamo } from './hangul';
import { normalizeText } from './lexicon';

describe('한글 처리', () => {
  it('한글 모드로 친 코드(05 §8.2 예)', () => {
    const cases: Record<string, string> = {
      헤: 'GP',
      햐ㅔ: 'GIP',
      ㅈ댜: 'WEI',
      ㄹㅌㅊ: 'FXC',
      ㅊ교ㅔ: 'CRYP',
      ㄷ벼ㅑ쇼: 'EQUITY',
      ㅏㄴ: 'KS',
      ㅁ메ㅣ: 'AAPL',
      ㅠㅅㅊ: 'BTC',
      해: 'GO',
    };
    for (const [ko, en] of Object.entries(cases)) expect(hangulToQwerty(ko)).toBe(en);
  });

  it('영문 자판 → 한글, 도깨비불', () => {
    expect(qwertyToHangul('tkatjd')).toBe('삼성');
    expect(qwertyToHangul('tkatjdwjswk')).toBe('삼성전자');
    expect(qwertyToHangul('rksk')).toBe('가나');
    expect(qwertyToHangul('dkswjs')).toBe('안전');
    expect(composeJamo(['ㄱ', 'ㅏ', 'ㄹ', 'ㄱ', 'ㅏ'])).toBe('갈가');
    expect(composeJamo(['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ', 'ㅅ'])).toBe('닭ㅅ');
  });

  it('초성과 자모', () => {
    expect(toChosung('SK하이닉스')).toBe('SKㅎㅇㄴㅅ');
    expect(toKeystrokeJamo('삼성저')).toBe('ㅅㅏㅁㅅㅓㅇㅈㅓ');
    expect(toKeystrokeJamo('삼성전자').startsWith(toKeystrokeJamo('삼성저'))).toBe(true);
    expect(splitDoubleConsonants('ㄳㅈ')).toBe('ㄱㅅㅈ');
    expect(hangulToKeys('삼성전자')).toBe('tkatjdwjswk');
  });

  it('정규화는 낱자 자모를 바꾸지 않고 전각만 반각으로', () => {
    expect(normalizeText('ㅈ댜')).toBe('ㅈ댜');
    expect(normalizeText('ＡＡＰＬ')).toBe('AAPL');
    expect(normalizeText('<GO>')).toBe('GO');
  });
});
