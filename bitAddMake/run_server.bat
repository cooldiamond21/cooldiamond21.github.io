@echo off
setlocal
cd /d %~dp0
echo Starting Bitcoin Master Local Server on http://localhost:5000...
powershell -ExecutionPolicy Bypass -File server.ps1
pause
