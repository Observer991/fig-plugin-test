@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

SET "EXE_SRC=%~dp0work-logger-server.exe"
SET "INSTALL_DIR=%LOCALAPPDATA%\WorkLogger"
SET "EXE_DST=%INSTALL_DIR%\work-logger-server.exe"
SET "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
SET "LAUNCHER=%STARTUP_DIR%\work-logger.vbs"

echo.
echo ======================================
echo   Work Logger Server Installer
echo ======================================
echo.

:: exe 존재 확인
if not exist "%EXE_SRC%" (
  echo [오류] work-logger-server.exe 를 찾을 수 없습니다.
  echo        install.bat 과 같은 폴더에 exe 파일이 있어야 합니다.
  echo.
  pause
  exit /b 1
)

:: 설치 디렉토리 생성 및 exe 복사
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%EXE_SRC%" "%EXE_DST%" > nul
if errorlevel 1 (
  echo [오류] 파일 복사에 실패했습니다.
  pause
  exit /b 1
)

:: 시작 프로그램용 VBS 런처 생성 (콘솔 창 없이 숨김 실행)
(
  echo Dim sh
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.Run Chr^(34^) ^& "%EXE_DST%" ^& Chr^(34^), 0, False
  echo Set sh = Nothing
) > "%LAUNCHER%"

echo [완료] 설치 위치  : %EXE_DST%
echo [완료] 자동 시작  : 로그인 시 백그라운드에서 자동 실행됩니다.
echo.

:: 지금 바로 서버 시작
echo 서버를 시작합니다...
start "" wscript.exe "%LAUNCHER%"
timeout /t 2 > nul

echo [실행 중] 포트 3000 에서 서버가 실행 중입니다.
echo.
echo Figma 플러그인에서 [연결 테스트] 버튼을 눌러 확인하세요.
echo.
echo 제거하려면 uninstall.bat 을 실행하세요.
echo.
pause
