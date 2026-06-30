@echo off
title WebViz Explorer - Dev Server
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js / npm nao encontrado.
  echo Instale em: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo Instalando dependencias pela primeira vez...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo ========================================
echo   WebViz Explorer - modo desenvolvimento
echo ========================================
echo.
echo   Site:    http://localhost:5174/
echo   Preview: http://localhost:5174/preview-dual.html
echo   Editor:  http://localhost:5174/edit.html
echo.
echo   Deixe esta janela aberta enquanto usar o site.
echo   Para parar: feche a janela ou pressione Ctrl+C
echo.
echo ========================================
echo.

call npm run dev

echo.
echo Servidor encerrado.
pause
