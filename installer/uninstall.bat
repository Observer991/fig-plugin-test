@echo off
chcp 65001 > nul

SET "INSTALL_DIR=%LOCALAPPDATA%\WorkLogger"
SET "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
SET "LAUNCHER=%STARTUP_DIR%\work-logger.vbs"

echo.
echo ======================================
echo   Work Logger Server Uninstaller
echo ======================================
echo.

echo 실행 중인 서버를 종료합니다...
taskkill /f /im work-logger-server.exe 2>nul

echo 시작 프로그램 등록을 해제합니다...
if exist "%LAUNCHER%" (
  del /q "%LAUNCHER%"
  echo [완료] 자동 시작 해제
) else (
  echo [스킵] 자동 시작 항목 없음
)

echo 설치 파일을 제거합니다...
if exist "%INSTALL_DIR%" (
  rd /s /q "%INSTALL_DIR%"
  echo [완료] %INSTALL_DIR% 삭제
) else (
  echo [스킵] 설치 파일 없음
)

echo.
echo [완료] Work Logger 서버가 제거되었습니다.
echo.
pause
