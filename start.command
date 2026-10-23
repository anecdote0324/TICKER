#!/bin/bash
# 개발 중 실행 스크립트(01 실행 방식): 서버를 켜고 브라우저를 열어요. 끌 때는 이 창에서 Ctrl+C
cd "$(dirname "$0")"
command -v pnpm >/dev/null 2>&1 || corepack enable
pnpm install
pnpm dev
