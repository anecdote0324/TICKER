// 떼어낸 창(패널 묶음 창과 화면 창)의 문서를 메인 창처럼 꾸며요: 스타일 복사, 색·글자 크기, 앱 단축키(05 §14.3).
// 창의 load 뒤에 불러요. 그 전 문서(about:blank)는 load 때 바뀌어서 거기에 넣은 것은 사라져요.

import { attachGlobalKeys } from './keys';
import { applyTheme, popoutDocuments, settings } from './stores/settings';

export function preparePopoutDocument(win: Window): Document {
  const doc = win.document;
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.appendChild(node.cloneNode(true));
  applyTheme(settings.get(), doc);
  popoutDocuments.add(doc);
  attachGlobalKeys(win);
  return doc;
}

export function releasePopoutDocument(doc: Document | null | undefined) {
  if (doc) popoutDocuments.delete(doc);
}
