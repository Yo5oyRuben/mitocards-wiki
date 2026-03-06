@echo off
cd /d "%~dp0"
echo Iniciando entorno local con Vercel...
echo.
set MITOCARDS_FORCE_LOCAL=1
echo Modo local forzado: MITOCARDS_FORCE_LOCAL=1
echo.
npx vercel dev
