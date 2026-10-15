# Activate the repo's Python 3.13 venv in the current PowerShell session.
# Usage (dot-source it):  . .\use-python.ps1
# Creates .\.venv from $env:VIAL_PYTHON_HOME (default: scoop's python313) and installs the requirements if missing or
# changed since they were last installed.
# Undo with:  deactivate

$pyHome = if ($env:VIAL_PYTHON_HOME) { $env:VIAL_PYTHON_HOME } else { Join-Path $env:USERPROFILE 'scoop\apps\python313\current' }
$venv = Join-Path $PSScriptRoot '.venv'

$venvPy = Join-Path $venv 'Scripts\python.exe'
$marker = Join-Path $venv '.vial-installed'

if (-not (Test-Path $venvPy)) {
    if (-not (Test-Path (Join-Path $pyHome 'python.exe'))) {
        Write-Error "python.exe not found in $pyHome (set `$env:VIAL_PYTHON_HOME)"
        return
    }
    Write-Host "Creating .venv with $pyHome\python.exe ..."
    & "$pyHome\python.exe" -m venv $venv
    if ($LASTEXITCODE -ne 0) { Write-Error "venv creation failed"; return }
}

# .venv\.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
# The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so the three agree.
$hashCode = 'import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())'
$reqHash = "$(& $venvPy -c $hashCode $PSScriptRoot requirements.txt test-requirements.txt requirements-fbs.txt)".Trim()
if ($LASTEXITCODE -ne 0 -or -not $reqHash) { Write-Error "could not read the requirement files"; return }
$installed = if (Test-Path $marker) { "$(Get-Content $marker -Raw)".Trim() } else { '' }

if ($installed -ne $reqHash) {
    Write-Host "Installing requirements ..."
    & $venvPy -m pip install --quiet --upgrade pip
    if ($LASTEXITCODE -ne 0) { Write-Error "pip upgrade failed; rerun to retry"; return }
    & $venvPy -m pip install --quiet -r (Join-Path $PSScriptRoot 'test-requirements.txt')
    if ($LASTEXITCODE -ne 0) { Write-Error "installing test-requirements.txt failed; rerun to retry"; return }
    & $venvPy -m pip install --quiet --no-deps -r (Join-Path $PSScriptRoot 'requirements-fbs.txt')
    if ($LASTEXITCODE -ne 0) { Write-Error "installing requirements-fbs.txt failed; rerun to retry"; return }
    Set-Content -Path $marker -Value $reqHash
}

. (Join-Path $venv 'Scripts\Activate.ps1')
Set-Alias -Name python3 -Value python -Scope Global

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
