@echo off
echo Starting PalPanel + Cloudflare Tunnel...

cd /d D:\Work\palworld-panel
start "PalPanel" cmd /c "npm start"

timeout /t 3 /nobreak >nul

start "CloudTunnel" cmd /c "cloudflared tunnel --url http://localhost:48213"

echo All started! You can close this window.
