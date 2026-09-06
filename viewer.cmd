@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
    py -3 "%~dp0files\orbital_viewer.py" %*
    goto done
)
if exist "%LocalAppData%\Python\pythoncore-3.14-64\python.exe" (
    "%LocalAppData%\Python\pythoncore-3.14-64\python.exe" "%~dp0files\orbital_viewer.py" %*
    goto done
)
python "%~dp0files\orbital_viewer.py" %*
:done
if errorlevel 1 pause
