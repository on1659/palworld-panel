@echo off
echo Stopping PalPanel + Tunnel...

taskkill /F /FI "WINDOWTITLE eq PalPanel*" >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

echo Done!
pause
