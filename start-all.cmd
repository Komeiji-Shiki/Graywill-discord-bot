@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo ==========================================
echo   GrayWill Discord Bot - One Click Start
echo ==========================================
echo.

echo [1/4] Checking Node.js and npm ...
where node >nul 2>nul || (
  echo [ERROR] Node.js not found in PATH.
  echo Please install Node.js 18+ first.
  pause
  exit /b 1
)
where npm >nul 2>nul || (
  echo [ERROR] npm not found in PATH.
  pause
  exit /b 1
)

echo [2/4] Checking dependencies ...
if not exist ".\node_modules" (
  echo Installing backend dependencies ...
  call npm install || goto :fail
)

if not exist ".\web\node_modules" (
  echo Installing frontend dependencies ...
  call npm --prefix .\web install || goto :fail
)

echo [3/4] Releasing occupied ports (3000, 5714) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING 2^>nul') do (
  echo   Killing process on port 3000 ^(PID: %%a^) ...
  taskkill /PID %%a /F >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5714 " ^| findstr LISTENING 2^>nul') do (
  echo   Killing process on port 5714 ^(PID: %%a^) ...
  taskkill /PID %%a /F >nul 2>nul
)

echo [4/4] Starting backend + frontend in one window ...
call npm run dev:all
exit /b 0

:fail
echo.
echo [ERROR] Startup failed.
pause
exit /b 1