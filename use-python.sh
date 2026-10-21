# Activate the repo's Python 3.13 venv in the current Git Bash / MSYS shell.
# Usage (source it):  source ./use-python.sh
# Creates ./.venv from VIAL_PYTHON_HOME (default: scoop's python313) and installs the requirements if missing or
# changed since they were last installed.
# Undo with:  deactivate

VIAL_PYTHON_HOME="${VIAL_PYTHON_HOME:-$USERPROFILE\\scoop\\apps\\python313\\current}"
_vial_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_vial_venvpy="$_vial_repo/.venv/Scripts/python.exe"

if [ ! -f "$_vial_venvpy" ]; then
    _vial_py="$(cygpath -u "$VIAL_PYTHON_HOME")/python.exe"
    if [ ! -f "$_vial_py" ]; then
        echo "python.exe not found in $VIAL_PYTHON_HOME (set VIAL_PYTHON_HOME)" >&2
        unset _vial_repo _vial_py _vial_venvpy
        return 1 2>/dev/null || exit 1
    fi
    echo "Creating .venv with $_vial_py ..."
    if ! "$_vial_py" -m venv "$(cygpath -w "$_vial_repo/.venv")"; then
        echo "venv creation failed" >&2
        unset _vial_repo _vial_py _vial_venvpy
        return 1 2>/dev/null || exit 1
    fi
    unset _vial_py
fi

# .venv/.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
# The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so the three agree.
_vial_hashcode='import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())'
_vial_hash="$("$_vial_venvpy" -c "$_vial_hashcode" "$(cygpath -w "$_vial_repo")" requirements.txt test-requirements.txt | tr -d '\r')"
unset _vial_hashcode
if [ -z "$_vial_hash" ]; then
    echo "could not read the requirement files" >&2
    unset _vial_repo _vial_venvpy _vial_hash
    return 1 2>/dev/null || exit 1
fi

if [ "$(cat "$_vial_repo/.venv/.vial-installed" 2>/dev/null | tr -d '\r\n')" != "$_vial_hash" ]; then
    echo "Installing requirements ..."
    if ! { "$_vial_venvpy" -m pip install --quiet --upgrade pip &&
           "$_vial_venvpy" -m pip install --quiet -r "$(cygpath -w "$_vial_repo/test-requirements.txt")"; }; then
        echo "installing requirements failed; rerun to retry" >&2
        unset _vial_repo _vial_venvpy _vial_hash
        return 1 2>/dev/null || exit 1
    fi
    printf '%s\r\n' "$_vial_hash" > "$_vial_repo/.venv/.vial-installed"
fi
unset _vial_venvpy _vial_hash

source "$_vial_repo/.venv/Scripts/activate"
alias python3=python
unset _vial_repo

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
