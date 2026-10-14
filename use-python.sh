# Activate the repo's Python 3.6 venv in the current Git Bash / MSYS shell.
# Usage (source it):  source ./use-python.sh
# Creates ./venv from VIAL_PYTHON_HOME (default T:\python-3.6.8-amd64) if missing.
# Undo with:  deactivate

VIAL_PYTHON_HOME="${VIAL_PYTHON_HOME:-T:\\python-3.6.8-amd64}"
_vial_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$_vial_repo/venv/Scripts/python.exe" ]; then
    _vial_py="$(cygpath -u "$VIAL_PYTHON_HOME")/python.exe"
    if [ ! -f "$_vial_py" ]; then
        echo "python.exe not found in $VIAL_PYTHON_HOME (set VIAL_PYTHON_HOME)" >&2
        unset _vial_repo _vial_py
        return 1 2>/dev/null || exit 1
    fi
    echo "Creating venv with $_vial_py ..."
    "$_vial_py" -m venv "$(cygpath -w "$_vial_repo/venv")"
    echo "Now run:  pip install -r requirements.txt"
    unset _vial_py
fi

source "$_vial_repo/venv/Scripts/activate"
# Python 3.6's activate puts a Windows path (T:\...) on PATH, which breaks on the ':'
export PATH="$_vial_repo/venv/Scripts:$_OLD_VIRTUAL_PATH"
alias python3=python
unset _vial_repo

python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"
