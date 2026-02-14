@echo off

echo Starting PalPanel + ngrok Tunnel...

cd /d D:\Work\palworld-panel

start "PalPanel" cmd /c "npm start"

timeout /t 3 /nobreak >nul

start "ngrokTunnel" cmd /c "ngrok http 48213 --domain=tactless-diplocardiac-deacon.ngrok-free.dev"

echo All started! You can close this window.