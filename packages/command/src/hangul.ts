// 한글 처리: 자모 분해, 초성, 두벌식 한/영 변환(05 §6, §8.2)

const SBASE = 0xac00;
const SLAST = 0xd7a3;
const NJUNG = 21;
const NJONG = 28;

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 겹모음·겹받침을 키 입력 순서로 나눈 것 */
const SPLIT: Record<string, string> = {
  ㅘ: 'ㅗㅏ',
  ㅙ: 'ㅗㅐ',
  ㅚ: 'ㅗㅣ',
  ㅝ: 'ㅜㅓ',
  ㅞ: 'ㅜㅔ',
  ㅟ: 'ㅜㅣ',
  ㅢ: 'ㅡㅣ',
  ㄳ: 'ㄱㅅ',
  ㄵ: 'ㄴㅈ',
  ㄶ: 'ㄴㅎ',
  ㄺ: 'ㄹㄱ',
  ㄻ: 'ㄹㅁ',
  ㄼ: 'ㄹㅂ',
  ㄽ: 'ㄹㅅ',
  ㄾ: 'ㄹㅌ',
  ㄿ: 'ㄹㅍ',
  ㅀ: 'ㄹㅎ',
  ㅄ: 'ㅂㅅ',
};

/** 두벌식 자판: 자모 → 영문 키 */
const KEY_OF: Record<string, string> = {
  ㅂ: 'q', ㅈ: 'w', ㄷ: 'e', ㄱ: 'r', ㅅ: 't', ㅛ: 'y', ㅕ: 'u', ㅑ: 'i', ㅐ: 'o', ㅔ: 'p',
  ㅁ: 'a', ㄴ: 's', ㅇ: 'd', ㄹ: 'f', ㅎ: 'g', ㅗ: 'h', ㅓ: 'j', ㅏ: 'k', ㅣ: 'l',
  ㅋ: 'z', ㅌ: 'x', ㅊ: 'c', ㅍ: 'v', ㅠ: 'b', ㅜ: 'n', ㅡ: 'm',
  ㅃ: 'Q', ㅉ: 'W', ㄸ: 'E', ㄲ: 'R', ㅆ: 'T', ㅒ: 'O', ㅖ: 'P',
};

const JAMO_OF: Record<string, string> = Object.fromEntries(Object.entries(KEY_OF).map(([j, k]) => [k, j]));

const COMPAT_CONSONANTS = new Set([...CHO, ...JONG.filter(Boolean)]);
const COMPAT_VOWELS = new Set(JUNG);

export function isSyllable(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= SBASE && c <= SLAST;
}

export function isJamo(ch: string): boolean {
  return COMPAT_CONSONANTS.has(ch) || COMPAT_VOWELS.has(ch);
}

export function isConsonantJamo(ch: string): boolean {
  return COMPAT_CONSONANTS.has(ch);
}

export function hasHangul(s: string): boolean {
  for (const ch of s) if (isSyllable(ch) || isJamo(ch)) return true;
  return false;
}

/** 한글 음절을 초·중·종성으로 */
export function decompose(ch: string): [string, string, string] | null {
  if (!isSyllable(ch)) return null;
  const idx = ch.charCodeAt(0) - SBASE;
  const cho = Math.floor(idx / (NJUNG * NJONG));
  const jung = Math.floor((idx % (NJUNG * NJONG)) / NJONG);
  const jong = idx % NJONG;
  return [CHO[cho], JUNG[jung], JONG[jong]];
}

function splitJamo(j: string): string {
  return SPLIT[j] ?? j;
}

/**
 * 키 입력 순서의 자모 문자열. 한글이 아닌 글자는 소문자로 남겨요.
 * 삼성저 → ㅅㅏㅁㅅㅓㅇㅈㅓ (삼성전자의 자모 앞부분이 돼요, T5)
 */
export function toKeystrokeJamo(s: string): string {
  let out = '';
  for (const ch of s) {
    const d = decompose(ch);
    if (d) {
      out += d[0] + splitJamo(d[1]) + (d[2] ? splitJamo(d[2]) : '');
    } else if (isJamo(ch)) {
      out += splitJamo(ch);
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/** 초성 문자열. 한글이 아닌 글자는 대문자로 남겨요: SK하이닉스 → SKㅎㅇㄴㅅ */
export function toChosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const d = decompose(ch);
    if (d) out += d[0];
    else if (isJamo(ch)) out += ch;
    else out += ch.toUpperCase();
  }
  return out;
}

/** 초성 검색어의 겹자음(ㄳ 등)을 나눠요 */
export function splitDoubleConsonants(s: string): string {
  let out = '';
  for (const ch of s) out += isConsonantJamo(ch) ? splitJamo(ch) : ch;
  return out;
}

/** 자음 자모로만 이루어졌는지(초성 검색어) */
export function isChosungQuery(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!isConsonantJamo(ch)) return false;
  return true;
}

/**
 * 한글 → 영문 자판(대문자). 한글 모드로 친 코드를 알아봐요: 헤 → GP, ㅁ메ㅣ → AAPL.
 * Shift는 두벌식에서 7개 키만 바꿔서, 대소문자만 잃고 결과는 하나로 정해져요.
 */
export function hangulToQwerty(s: string): string {
  let out = '';
  for (const j of toKeystrokeJamo(s)) out += (KEY_OF[j] ?? j).toUpperCase();
  return out;
}

/** 한글 이름을 영문 자판으로 친 키(소문자): 삼성전자 → tkatjdwjswk */
export function hangulToKeys(s: string): string {
  let out = '';
  for (const j of toKeystrokeJamo(s)) {
    const k = KEY_OF[j];
    out += k ? k.toLowerCase() : j;
  }
  return out;
}

// ── 영문 자판 → 한글 조합 ──

function choIndex(j: string) {
  return CHO.indexOf(j);
}
function jungIndex(j: string) {
  return JUNG.indexOf(j);
}
function jongIndex(j: string) {
  return JONG.indexOf(j);
}

const COMBINE_VOWEL: Record<string, string> = {
  ㅗㅏ: 'ㅘ',
  ㅗㅐ: 'ㅙ',
  ㅗㅣ: 'ㅚ',
  ㅜㅓ: 'ㅝ',
  ㅜㅔ: 'ㅞ',
  ㅜㅣ: 'ㅟ',
  ㅡㅣ: 'ㅢ',
};
const COMBINE_JONG: Record<string, string> = Object.fromEntries(
  Object.entries(SPLIT)
    .filter(([k]) => jongIndex(k) > 0)
    .map(([k, v]) => [v, k]),
);

function compose(cho: string, jung: string, jong = ''): string {
  return String.fromCharCode(SBASE + (choIndex(cho) * NJUNG + jungIndex(jung)) * NJONG + jongIndex(jong));
}

/** 자모 나열을 음절로 조합(두벌식 오토마타). 도깨비불(받침이 다음 음절로 넘어감)도 처리해요 */
export function composeJamo(jamos: string[]): string {
  let out = '';
  let cho = '';
  let jung = '';
  let jong = '';
  const flush = () => {
    if (cho && jung) out += compose(cho, jung, jong);
    else out += cho + jung + jong;
    cho = jung = jong = '';
  };
  for (const j of jamos) {
    const isV = COMPAT_VOWELS.has(j);
    if (!isV) {
      if (cho && jung) {
        if (!jong) {
          if (jongIndex(j) > 0) jong = j;
          else {
            flush();
            cho = j;
          }
        } else {
          const comb = COMBINE_JONG[jong + j];
          if (comb) jong = comb;
          else {
            flush();
            cho = j;
          }
        }
      } else {
        flush();
        cho = j;
      }
    } else {
      if (cho && !jung) jung = j;
      else if (cho && jung && !jong) {
        const comb = COMBINE_VOWEL[jung + j];
        if (comb) jung = comb;
        else {
          flush();
          jung = j;
        }
      } else if (cho && jung && jong) {
        // 도깨비불: 받침(겹받침이면 뒤 자음)이 다음 음절의 초성이 돼요
        const split = SPLIT[jong];
        let carry: string;
        if (split && jongIndex(jong) > 0) {
          jong = split[0];
          carry = split[1];
        } else {
          carry = jong;
          jong = '';
        }
        flush();
        cho = carry;
        jung = j;
      } else if (!cho && jung) {
        const comb = COMBINE_VOWEL[jung + j];
        if (comb) jung = comb;
        else {
          flush();
          jung = j;
        }
      } else {
        flush();
        jung = j;
      }
    }
  }
  flush();
  return out;
}

/** 영문 자판 → 한글: tkatjd → 삼성. 영문이 아닌 글자는 그대로 */
export function qwertyToHangul(s: string): string {
  const jamos: string[] = [];
  let out = '';
  for (const ch of s) {
    const j = JAMO_OF[ch] ?? JAMO_OF[ch.toLowerCase()];
    if (j) jamos.push(j);
    else {
      out += composeJamo(jamos.splice(0)) + ch;
    }
  }
  return out + composeJamo(jamos);
}
