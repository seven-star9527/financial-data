@echo off
title 财务工具中台
echo ======================================================
echo           Financial Tool Hub Central Server
echo ======================================================
echo.

cd /d %~dp0

:: Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed! Please install Node.js first.
    pause
    exit
)

:: Check node_modules
if not exist "node_modules\" (
    echo [INFO] Installing required dependencies, please wait...
    call npm install
)

echo [INFO] Starting Central Server...
start http://localhost:8081
node server.js

pause
