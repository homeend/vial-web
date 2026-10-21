@echo off
rem Activate the repo's Python 3.13 venv in the current cmd.exe session.
rem Usage:  use-python.cmd
rem Creates .venv from VIAL_PYTHON_HOME (default: scoop's python313) and installs the requirements if missing or
rem changed since they were last installed.
rem Undo with:  deactivate

if not defined VIAL_PYTHON_HOME set "VIAL_PYTHON_HOME=%USERPROFILE%\scoop\apps\python313\current"

if exist "%~dp0.venv\Scripts\python.exe" goto install
if not exist "%VIAL_PYTHON_HOME%\python.exe" (
    echo python.exe not found in %VIAL_PYTHON_HOME% ^(set VIAL_PYTHON_HOME^) 1>&2
    exit /b 1
)
echo Creating .venv with %VIAL_PYTHON_HOME%\python.exe ...
"%VIAL_PYTHON_HOME%\python.exe" -m venv "%~dp0.venv" || (echo venv creation failed 1>&2 & exit /b 1)

:install
rem .venv\.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
rem The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so the three agree.
"%~dp0.venv\Scripts\python.exe" -c "import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())" "%~dp0." requirements.txt test-requirements.txt > "%~dp0.venv\.vial-requirements" || (echo could not read the requirement files 1>&2 & exit /b 1)
set "_vial_hash="
set "_vial_installed="
set /p _vial_hash=<"%~dp0.venv\.vial-requirements"
del "%~dp0.venv\.vial-requirements"
if exist "%~dp0.venv\.vial-installed" set /p _vial_installed=<"%~dp0.venv\.vial-installed"
if not defined _vial_hash (echo could not read the requirement files 1>&2 & exit /b 1)
if "%_vial_hash%"=="%_vial_installed%" goto activate
echo Installing requirements ...
"%~dp0.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip || (echo pip upgrade failed; rerun to retry 1>&2 & exit /b 1)
"%~dp0.venv\Scripts\python.exe" -m pip install --quiet -r "%~dp0test-requirements.txt" || (echo installing test-requirements.txt failed; rerun to retry 1>&2 & exit /b 1)
>"%~dp0.venv\.vial-installed" echo %_vial_hash%

:activate
set "_vial_hash="
set "_vial_installed="
call "%~dp0.venv\Scripts\activate.bat"
doskey python3=python $*

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
