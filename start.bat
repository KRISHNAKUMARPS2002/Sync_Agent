@echo off
cd /d %~dp0
echo Starting Sync Agent...
node sync.js
pause
