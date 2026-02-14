@echo off
echo Stopping PalPanel + ngrok Tunnel...
taskkill /F /FI "WINDOWTITLE eq PalPanel*" >nul 2>&1
taskkill /F /IM ngrok.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
echo Done!
pause