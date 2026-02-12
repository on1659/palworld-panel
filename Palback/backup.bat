@echo off
setlocal EnableExtensions

REM === 경로 설정 ===
set "SourcePath=D:\SteamLibrary\steamapps\common\PalServer\Pal\Saved\SaveGames\0\286264E7489EA8B960EFC9BD09E47ADD"
set "BackupRoot=C:\Users\on165\Desktop\Palback"
set "FolderTag=PalServerSave"

REM === 타임스탬프 (PowerShell 한 줄만 호출해서 문자열만 가져옴) ===
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"

set "Dest=%BackupRoot%\%FolderTag%_%TS%"

if not exist "%SourcePath%" (
  echo [ERROR] 원본 없음: "%SourcePath%"
  exit /b 100
)
if not exist "%BackupRoot%" mkdir "%BackupRoot%"

if exist "%Dest%" rmdir /s /q "%Dest%"
mkdir "%Dest%"

REM === 복사 ===
robocopy "%SourcePath%" "%Dest%" /E /Z /COPY:DAT /R:2 /W:2 /XJ /NFL /NDL /NP
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo [ERROR] 백업 실패. robocopy 코드: %RC%
  exit /b %RC%
)

echo [OK] 백업 완료: "%Dest%"
exit /b 0
