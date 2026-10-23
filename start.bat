@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 개발 중 실행 스크립트(01 실행 방식): 서버를 켜고 브라우저를 열어요. 끌 때는 이 창에서 Ctrl+C
where pnpm >nul 2>nul || call corepack enable
call pnpm install
call pnpm dev
