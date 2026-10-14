@echo off
rem Activate the repo's Python 3.6 venv in the current cmd.exe session.
rem Usage:  use-python.cmd
rem Creates venv from VIAL_PYTHON_HOME (default T:\python-3.6.8-amd64) if missing.
rem Undo with:  deactivate

if not defined VIAL_PYTHON_HOME set "VIAL_PYTHON_HOME=T:\python-3.6.8-amd64"

if exist "%~dp0venv\Scripts\python.exe" goto activate
if not exist "%VIAL_PYTHON_HOME%\python.exe" (
    echo python.exe not found in %VIAL_PYTHON_HOME% ^(set VIAL_PYTHON_HOME^) 1>&2
    exit /b 1
)
echo Creating venv with %VIAL_PYTHON_HOME%\python.exe ...
"%VIAL_PYTHON_HOME%\python.exe" -m venv "%~dp0venv"
echo Now run:  pip install -r requirements.txt

:activate
call "%~dp0venv\Scripts\activate.bat"
doskey python3=python $*

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
