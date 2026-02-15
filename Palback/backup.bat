@echo off
setlocal EnableExtensions

REM === 경로 설정 (palback_config.cmd에서 로드, 없으면 아래 기본값 사용) ===
if exist "%~dp0palback_config.cmd" call "%~dp0palback_config.cmd"
if not defined PAL_SAVE_PATH set "PAL_SAVE_PATH=YOUR_PAL_SAVE_PATH"
if not defined PAL_BACKUP_ROOT set "PAL_BACKUP_ROOT=YOUR_PAL_BACKUP_ROOT"
set "SourcePath=%PAL_SAVE_PATH%"
set "BackupRoot=%PAL_BACKUP_ROOT%"
set "FolderTag=PalServerSave"

if "%SourcePath%"=="YOUR_PAL_SAVE_PATH" (
  echo [ERROR] PAL_SAVE_PATH가 설정되지 않았습니다. palback_config.cmd.example 을 palback_config.cmd 로 복사해 경로를 설정하세요.
  exit /b 101
)
if "%BackupRoot%"=="YOUR_PAL_BACKUP_ROOT" (
  echo [ERROR] PAL_BACKUP_ROOT가 설정되지 않았습니다. palback_config.cmd.example 을 palback_config.cmd 로 복사해 경로를 설정하세요.
  exit /b 102
)

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
