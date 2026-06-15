@echo off
REM run.bat - Double-click launcher for Windows.
REM
REM Starts the xyz_simulator FastAPI app with uvicorn (auto-reload) so you can
REM open http://localhost:8001/ in a browser. Installs requirements.txt on
REM first run if needed.
REM
REM Usage:
REM   Double-click this file, or run from a terminal:
REM     run.bat            (start on port 8001)
REM     set PORT=8080 & run.bat   (start on a different port)

setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=8001

python -c "import uvicorn, fastapi" >nul 2>&1
if errorlevel 1 (
    echo Installing requirements...
    pip install -r "%~dp0requirements.txt"
)

cd /d "%~dp0motor_control\xyz_simulator"
echo Starting Robot Control UI at http://localhost:%PORT%/
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %PORT%

pause
