@echo off
setlocal
cd /d "%~dp0"

rem Serves the newest branch from a preview worktree (see tools\run_latest.ps1).
rem   run.bat            newest local or origin branch
rem   run.bat BRANCH     a specific branch or commit
rem   run.bat --here     this folder as-is
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_latest.ps1" %*
if errorlevel 1 pause
exit /b %errorlevel%
