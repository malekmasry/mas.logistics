@echo off
cd /d "%~dp0"
echo --- MAS Logistics Setup ---
echo 1. Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    pause
    exit /b
)

echo 2. Setting up Virtual Environment...
if not exist .venv (
    python -m venv .venv
)

echo 3. Installing/Updating Requirements...
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\pip.exe install fastapi uvicorn pandas networkx openpyxl requests python-dotenv pydantic

echo 4. Verification...
if exist data.xlsx (
    echo [OK] data.xlsx found.
) else (
    echo [WARNING] data.xlsx not found. Ensure you renamed your Excel file to data.xlsx.
)

echo --- Setup Complete ---
echo You can now run the app using run_app.bat
pause
