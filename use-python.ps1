# Activate the repo's Python 3.13 venv in the current PowerShell session.
# Usage (dot-source it):  . .\use-python.ps1
# Creates .\.venv from $env:VIAL_PYTHON_HOME (default: scoop's python313) and installs the requirements if missing.
# Undo with:  deactivate

$pyHome = if ($env:VIAL_PYTHON_HOME) { $env:VIAL_PYTHON_HOME } else { Join-Path $env:USERPROFILE 'scoop\apps\python313\current' }
$venv = Join-Path $PSScriptRoot '.venv'

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    if (-not (Test-Path (Join-Path $pyHome 'python.exe'))) {
        Write-Error "python.exe not found in $pyHome (set `$env:VIAL_PYTHON_HOME)"
        return
    }
    Write-Host "Creating .venv with $pyHome\python.exe and installing requirements ..."
    & "$pyHome\python.exe" -m venv $venv
    & "$venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
    & "$venv\Scripts\python.exe" -m pip install --quiet -r (Join-Path $PSScriptRoot 'test-requirements.txt')
    & "$venv\Scripts\python.exe" -m pip install --quiet --no-deps -r (Join-Path $PSScriptRoot 'requirements-fbs.txt')
}

. (Join-Path $venv 'Scripts\Activate.ps1')
Set-Alias -Name python3 -Value python -Scope Global

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
