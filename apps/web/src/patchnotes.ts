// 앱에 넣어 둔 패치노트(저장소 patchnote/*.md). 빌드할 때 화면 파일에 함께 묶여요.

import { parsePatchNotes } from './patchnoteParse';

const files = import.meta.glob('../../../patchnote/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const PATCH_NOTES = parsePatchNotes(files);
