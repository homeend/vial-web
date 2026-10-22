@echo off
rem Build Vial in one go: dist\Vial.exe.
rem Usage (from cmd or PowerShell):  build-local.cmd
rem 1. Activates the venv with use-python.cmd, which creates .venv and installs the Python requirements when they
rem    changed since they were last installed.
rem 2. Installs the web UI's npm packages (npm ci) when web\package-lock.json changed since they were last installed.
rem 3. Builds the web UI, then the executable, then runs the smoke test (simulated keyboard: no keyboard is opened).
rem Linux, macOS: build-local.sh.

setlocal
cd /d "%~dp0" || exit /b 1

call "%~dp0use-python.cmd" || (echo build-local: the venv could not be set up 1>&2 & exit /b 1)

where npm >nul 2>&1 || (echo build-local: npm not found: install Node 24 with npm 11 1>&2 & exit /b 1)

rem web\node_modules\.vial-package-lock.json is a copy of the package-lock.json last installed: when it differs,
rem install again.
fc /b web\package-lock.json web\node_modules\.vial-package-lock.json >nul 2>&1 && goto web
echo Installing the web UI's npm packages ...
pushd web
call npm ci --no-audit --no-fund || (popd & echo build-local: npm ci failed 1>&2 & exit /b 1)
popd
copy /y web\package-lock.json web\node_modules\.vial-package-lock.json >nul

:web
echo Building the web UI ...
pushd web
call npm run build || (popd & echo build-local: building the web UI failed 1>&2 & exit /b 1)
popd

echo Building the executable ...
python -m PyInstaller --noconfirm vial.spec || (echo build-local: building the executable failed 1>&2 & exit /b 1)

echo Checking that it runs ...
python util\smoke_test.py dist\Vial.exe || (echo build-local: the smoke test failed 1>&2 & exit /b 1)

echo.
echo Built: %~dp0dist\Vial.exe
