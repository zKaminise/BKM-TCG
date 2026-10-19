@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22.13 ou mais recente para configurar a loja.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
node scripts/configure-supabase.cjs %*
set "BKM_CONFIG_EXIT=%errorlevel%"
pause
exit /b %BKM_CONFIG_EXIT%
