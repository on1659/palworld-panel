@echo off
setlocal

echo Starting PalPanel + ngrok Tunnel...

cd /d "%~dp0"

for /f "delims=" %%i in ('node -e "require('dotenv').config(); console.log(process.env.PORT || 3000);"') do set PANEL_PORT=%%i
if not defined PANEL_PORT set PANEL_PORT=3000

start "PalPanel" cmd /c "npm start"

timeout /t 3 /nobreak >nul

start "ngrokTunnel" cmd /c "ngrok http %PANEL_PORT% --domain=tactless-diplocardiac-deacon.ngrok-free.dev"

echo All started! You can close this window.
endlocal