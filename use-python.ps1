# Activate the repo's Python 3.6 venv in the current PowerShell session.
# Usage (dot-source it):  . .\use-python.ps1
# Creates .\venv from $env:VIAL_PYTHON_HOME (default T:\python-3.6.8-amd64) if missing.
# Undo with:  deactivate

$pyHome = if ($env:VIAL_PYTHON_HOME) { $env:VIAL_PYTHON_HOME } else { 'T:\python-3.6.8-amd64' }
$venv = Join-Path $PSScriptRoot 'venv'

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    if (-not (Test-Path (Join-Path $pyHome 'python.exe'))) {
        Write-Error "python.exe not found in $pyHome (set `$env:VIAL_PYTHON_HOME)"
        return
    }
    Write-Host "Creating venv with $pyHome\python.exe ..."
    & "$pyHome\python.exe" -m venv $venv
    Write-Host "Now run:  pip install -r requirements.txt"
}

. (Join-Path $venv 'Scripts\Activate.ps1')
Set-Alias -Name python3 -Value python -Scope Global

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
