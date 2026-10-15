# Activate the repo's Python 3.13 venv in the current Git Bash / MSYS shell.
# Usage (source it):  source ./use-python.sh
# Creates ./.venv from VIAL_PYTHON_HOME (default: scoop's python313) and installs the requirements if missing.
# Undo with:  deactivate

VIAL_PYTHON_HOME="${VIAL_PYTHON_HOME:-$USERPROFILE\\scoop\\apps\\python313\\current}"
_vial_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$_vial_repo/.venv/Scripts/python.exe" ]; then
    _vial_py="$(cygpath -u "$VIAL_PYTHON_HOME")/python.exe"
    if [ ! -f "$_vial_py" ]; then
        echo "python.exe not found in $VIAL_PYTHON_HOME (set VIAL_PYTHON_HOME)" >&2
        unset _vial_repo _vial_py
        return 1 2>/dev/null || exit 1
    fi
    echo "Creating .venv with $_vial_py and installing requirements ..."
    "$_vial_py" -m venv "$(cygpath -w "$_vial_repo/.venv")"
    "$_vial_repo/.venv/Scripts/python.exe" -m pip install --quiet --upgrade pip
    "$_vial_repo/.venv/Scripts/python.exe" -m pip install --quiet -r "$(cygpath -w "$_vial_repo/test-requirements.txt")"
    "$_vial_repo/.venv/Scripts/python.exe" -m pip install --quiet --no-deps -r "$(cygpath -w "$_vial_repo/requirements-fbs.txt")"
    unset _vial_py
fi

source "$_vial_repo/.venv/Scripts/activate"
alias python3=python
unset _vial_repo

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
