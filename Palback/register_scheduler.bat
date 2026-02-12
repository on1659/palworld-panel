@echo off
REM === 스케줄러에 Palworld 백업 작업 등록 ===
REM 백업 스크립트 경로
set "BACKUP_BAT=C:\Users\on165\Desktop\Palback\backup.bat"

REM 작업 이름
set "TASK_NAME=Palworld Backup"

REM 기존 작업 삭제 (있을 경우)
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

REM 새 작업 등록: 30분마다 실행
schtasks /Create ^
 /TN "%TASK_NAME%" ^
 /SC MINUTE ^
 /MO 30 ^
 /TR "\"%BACKUP_BAT%\"" ^
 /RL HIGHEST ^
 /F ^
 /ST 00:00

echo [OK] 스케줄러 등록 완료 (30분마다): %BACKUP_BAT%
pause