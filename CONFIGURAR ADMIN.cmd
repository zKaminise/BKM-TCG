@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22.13 ou mais recente para configurar a loja.
  pause
  exit /b 1
)
if not exist node_modules\pg\package.json (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/create-admin.cjs
pause
