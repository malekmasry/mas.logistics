@echo off
setlocal
cd /d "%~dp0"

echo --- MAS Logistics Launcher ---

:: 1. Backend check
if not exist ".\.venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found. Please run setup.bat first.
    pause
    exit /b
)

:: 2. Frontend check
if not exist ".\frontend\node_modules" (
    echo [WARNING] frontend/node_modules not found. 
    echo Attempting to install frontend dependencies...
    pushd frontend
    call npm install
    popd
)

echo Starting MAS Logistics Backend...
start "MAS Backend" cmd /k ".\.venv\Scripts\python.exe main.py"

echo Starting MAS Logistics Frontend...
pushd frontend
start "MAS Frontend" cmd /k "npm run dev"
popd

echo.
echo Waiting for servers to initialize...
timeout /t 5 >nul

echo Opening browser...
start http://127.0.0.1:5173

echo.
echo Both servers have been launched in separate terminal windows.
echo Keep those windows open while using the application.
echo.
pause
