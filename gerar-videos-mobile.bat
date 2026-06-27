@echo off
title Gerar videos mobile
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js / npm nao encontrado.
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERRO] ffmpeg nao encontrado.
  echo Instale em: https://www.gyan.dev/ffmpeg/builds/
  echo.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Gerar videos MOBILE (public/media/mobile)
echo   Desktop nao e alterado.
echo ========================================
echo.

call npm run media:mobile

echo.
pause
