@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js para executar o site.
  pause
  exit /b 1
)
if not exist node_modules\pg\package.json (
  echo Instalando dependencias da BKM TCG...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/open-store.cjs
pause
