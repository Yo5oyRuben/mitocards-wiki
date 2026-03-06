@echo off
cd /d "%~dp0"
echo Actualizando variables de entorno desde Vercel...
echo.
npx vercel env pull .env.local
