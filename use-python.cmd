@echo off
rem Activate the repo's Python 3.13 venv in the current cmd.exe session.
rem Usage:  use-python.cmd
rem Creates .venv from VIAL_PYTHON_HOME (default: scoop's python313) and installs the requirements if missing.
rem Undo with:  deactivate

if not defined VIAL_PYTHON_HOME set "VIAL_PYTHON_HOME=%USERPROFILE%\scoop\apps\python313\current"

if exist "%~dp0.venv\Scripts\python.exe" goto activate
if not exist "%VIAL_PYTHON_HOME%\python.exe" (
    echo python.exe not found in %VIAL_PYTHON_HOME% ^(set VIAL_PYTHON_HOME^) 1>&2
    exit /b 1
)
echo Creating .venv with %VIAL_PYTHON_HOME%\python.exe and installing requirements ...
"%VIAL_PYTHON_HOME%\python.exe" -m venv "%~dp0.venv"
"%~dp0.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
"%~dp0.venv\Scripts\python.exe" -m pip install --quiet -r "%~dp0test-requirements.txt"
"%~dp0.venv\Scripts\python.exe" -m pip install --quiet --no-deps -r "%~dp0requirements-fbs.txt"

:activate
call "%~dp0.venv\Scripts\activate.bat"
doskey python3=python $*

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
