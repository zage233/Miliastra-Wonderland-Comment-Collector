@echo off
chcp 65001 >nul
if /i "%~1"=="--console" goto console
if exist "%~dp0..\Miliastra Wonderland Comment Collector.exe" (
  start "" "%~dp0..\Miliastra Wonderland Comment Collector.exe" %*
  exit /b
)
rem The GUI launcher runs Node with its console hidden. Do not wait in this CMD window.
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0启动.vbs" %*
exit /b

:console
shift
title Comment Collector
cd /d "%~dp0.."
set "NODE=node"
where node >nul 2>nul || set "NODE=D:\NodeJs\node.exe"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"
if exist "%~dp0..\node.exe" set "NODE=%~dp0..\node.exe"
echo.
echo   Starting... close the web page and this window closes itself.
echo.
"%NODE%" "%~dp0server.js"
rem Normal exit (auto-close after page closed) -> window closes. Only pause on real errors.
if errorlevel 1 (
  echo.
  echo   Server exited with an error. Press any key to close.
  pause >nul
)
exit
