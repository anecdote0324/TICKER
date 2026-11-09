// v0.6 CIX 수식 티커: 이미 받는 시세를 조합한 사용자 지수(스프레드·비율 등).
// 식 예: [005930] / [000660], [SPX] - [NDX] * 0.25, ([BTC] - [ETH] * 20) / 2
// 종목은 대괄호 안에 커맨드 라인처럼 적어요(코드, 'AAPL US' 처럼 시장 붙이기). 숫자와 + - * / 괄호만 써요(eval을 쓰지 않아요).

type Tok = { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'op'; v: '+' | '-' | '*' | '/' | 'neg' } | { t: 'lp' } | { t: 'rp' };

export interface CixFormula {
  /** 대괄호 안의 종목 글자(나온 순서, 겹치지 않게) */
  refs: string[];
  /** 역폴란드 표기 */
  rpn: Tok[];
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3 };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('대괄호 ]가 닫히지 않았어요');
      const ref = src.slice(i + 1, j).trim().replace(/\s+/g, ' ');
      if (!ref) throw new Error('빈 대괄호가 있어요');
      out.push({ t: 'ref', v: ref });
      i = j + 1;
      continue;
    }
    const num = src.slice(i).match(/^\d+(?:\.\d+)?|^\.\d+/);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (ch === '(') out.push({ t: 'lp' });
    else if (ch === ')') out.push({ t: 'rp' });
    else if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      const prev = out[out.length - 1];
      const unary = ch === '-' && (!prev || prev.t === 'op' || prev.t === 'lp');
      if (ch === '+' && (!prev || prev.t === 'op' || prev.t === 'lp')) {
        i++;
        continue;
      }
      out.push({ t: 'op', v: unary ? 'neg' : ch });
    } else throw new Error(`쓸 수 없는 글자예요: ${ch}`);
    i++;
  }
  return out;
}

/** 식 읽기. 틀리면 이유를 담은 오류를 던져요 */
export function parseCix(src: string): CixFormula {
  const toks = tokenize(src);
  if (!toks.length) throw new Error('식이 비어 있어요');
  const rpn: Tok[] = [];
  const ops: Tok[] = [];
  let expectValue = true;
  for (const tk of toks) {
    if (tk.t === 'num' || tk.t === 'ref') {
      if (!expectValue) throw new Error('값 사이에 연산자가 없어요');
      rpn.push(tk);
      expectValue = false;
    } else if (tk.t === 'op') {
      if (tk.v === 'neg') {
        if (!expectValue) throw new Error('식이 맞지 않아요');
        ops.push(tk);
        continue;
      }
      if (expectValue) throw new Error('연산자 앞에 값이 없어요');
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t !== 'op' || PREC[top.v] < PREC[tk.v]) break;
        rpn.push(ops.pop()!);
      }
      ops.push(tk);
      expectValue = true;
    } else if (tk.t === 'lp') {
      if (!expectValue) throw new Error('괄호 앞에 연산자가 없어요');
      ops.push(tk);
    } else {
      if (expectValue) throw new Error('괄호 안이 비었거나 끝에 연산자가 있어요');
      let found = false;
      while (ops.length) {
        const top = ops.pop()!;
        if (top.t === 'lp') {
          found = true;
          break;
        }
        rpn.push(top);
      }
      if (!found) throw new Error('괄호 짝이 맞지 않아요');
    }
  }
  if (expectValue) throw new Error('식이 연산자로 끝나요');
  while (ops.length) {
    const top = ops.pop()!;
    if (top.t === 'lp') throw new Error('괄호 짝이 맞지 않아요');
    rpn.push(top);
  }
  const refs: string[] = [];
  for (const tk of rpn) if (tk.t === 'ref' && !refs.includes(tk.v)) refs.push(tk.v);
  return { refs, rpn };
}

/** 값 계산. 종목 값이 하나라도 없거나 0으로 나누면 undefined */
export function evalCix(f: CixFormula, value: (ref: string) => number | undefined): number | undefined {
  const st: number[] = [];
  for (const tk of f.rpn) {
    if (tk.t === 'num') st.push(tk.v);
    else if (tk.t === 'ref') {
      const v = value(tk.v);
      if (v === undefined || !Number.isFinite(v)) return undefined;
      st.push(v);
    } else if (tk.t === 'op') {
      if (tk.v === 'neg') {
        st.push(-st.pop()!);
        continue;
      }
      const b = st.pop()!;
      const a = st.pop()!;
      if (tk.v === '/' && b === 0) return undefined;
      st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b : a / b);
    }
  }
  return st.length === 1 && Number.isFinite(st[0]) ? st[0] : undefined;
}

/** 대괄호 안 글자 → 코드와 시장('AAPL US' → AAPL, US) */
export function splitCixRef(ref: string): { code: string; market?: string } {
  const [code, market] = ref.trim().toUpperCase().split(/\s+/);
  return { code, market };
}
