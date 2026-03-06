@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Mitocards - Arranque local (Vercel)
echo ==========================================
echo.

echo [1/2] Sincronizando variables de entorno...
npx vercel env pull .env.local
if errorlevel 1 (
  echo.
  echo ERROR: no se pudieron sincronizar las variables.
  pause
  exit /b 1
)

echo.
echo [2/2] Iniciando servidor local...
echo (Pulsa Ctrl+C para detenerlo)
echo.
set MITOCARDS_FORCE_LOCAL=1
echo Modo local forzado: MITOCARDS_FORCE_LOCAL=1
echo.
npx vercel dev

endlocal
