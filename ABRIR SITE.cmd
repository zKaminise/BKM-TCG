@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js para executar o site.
  pause
  exit /b 1
)
node scripts/open-store.cjs
pause
