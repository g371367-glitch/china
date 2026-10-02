@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
title Сменить пароль — база знаний

set "PY="
python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >nul 2>nul && set "PY=python"
if not defined PY (
  py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  echo.
  echo Не найден Python 3. Установите с python.org и отметьте „Add to PATH“.
  echo.
  pause
  exit /b 1
)

%PY% app\team.py --set-password
if errorlevel 1 (
  echo.
  echo Пароль не изменён — причина выше.
)
echo.
pause
