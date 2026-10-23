// 커맨드 라인 글꼴(02 색과 글꼴): D2Coding. 한글이 영문 2칸 폭인 고정폭이라, 입력칸과 거울 줄의 글자 위치가 맞아요(05 §9).
// 패키지의 CSS는 woff·ttf까지 묶어서 크니, woff2만 골라 @font-face를 직접 만들어요.
// 떼어낸 창은 부모 창의 <style>을 복사하므로 <style>로 넣어요(05 §14.3).
// 라이선스: D2Coding © NAVER Corp., SIL Open Font License 1.1(설정 → 정보).

import d2Bold from 'd2coding/fonts/d2coding-bold-full.woff2?url';
import d2Regular from 'd2coding/fonts/d2coding-full.woff2?url';

const css = `
@font-face { font-family: 'D2Coding'; font-style: normal; font-weight: 400; font-display: swap; src: local('D2Coding'), url(${d2Regular}) format('woff2'); }
@font-face { font-family: 'D2Coding'; font-style: normal; font-weight: 700; font-display: swap; src: local('D2Coding Bold'), url(${d2Bold}) format('woff2'); }
`;

export function installFonts(doc: Document = document) {
  if (doc.querySelector('style[data-font="d2coding"]')) return;
  const style = doc.createElement('style');
  style.dataset.font = 'd2coding';
  style.textContent = css;
  doc.head.appendChild(style);
}
