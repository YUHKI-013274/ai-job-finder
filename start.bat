@echo off
chcp 65001 > nul
echo AI案件獲得システム Ver1.0 を起動します...
cd /d "%~dp0"
node run.js
if %errorlevel% equ 0 (
  echo.
  echo ブラウザで結果を開きます...
  start output\latest.html
)
pause
