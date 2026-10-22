#!/usr/bin/env bash
# Build Vial in one go: dist/vial.
# Usage:  ./build-local.sh
# 1. Activates the venv .venv, creating it with Python 3.13 when there is none (python3.13, or the Python that PYTHON
#    names: PYTHON=/path/to/python3.13 ./build-local.sh), and installs the Python requirements when they changed since
#    they were last installed.
# 2. Installs the web UI's npm packages (npm ci) when web/package-lock.json changed since they were last installed.
# 3. Builds the web UI, then the executable, then runs the smoke test (simulated keyboard: no keyboard is opened).
# Windows: build-local.cmd.

set -euo pipefail

fail() {
    echo "build-local: $1" >&2
    exit 1
}

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .venv/bin/python ]; then
    base="${PYTHON:-python3.13}"
    command -v "$base" >/dev/null || fail "$base not found: install Python 3.13, or name it with PYTHON=/path/to/python3.13"
    [ ! -e .venv ] || fail ".venv is there but has no bin/python: delete it and run again"
    echo "Creating .venv with $(command -v "$base") ..."
    # a half-made .venv would be taken for a whole one next time
    "$base" -m venv .venv || { rm -rf .venv; fail "venv creation failed (Debian, Ubuntu: install python3.13-venv)"; }
fi
.venv/bin/python -c 'import sys; sys.exit(sys.version_info[:2] != (3, 13))' ||
    fail ".venv has Python $(.venv/bin/python -c 'import platform; print(platform.python_version())'), not 3.13: delete .venv and run again"

# .venv/.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
# The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so they agree.
hashcode='import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())'
hash="$(.venv/bin/python -c "$hashcode" . requirements.txt test-requirements.txt)" || fail "could not read the requirement files"
if [ "$(tr -d '\r\n' < .venv/.vial-installed 2>/dev/null || true)" != "$hash" ]; then
    echo "Installing the Python requirements ..."
    .venv/bin/python -m pip install --quiet --upgrade pip || fail "pip upgrade failed; run again to retry"
    .venv/bin/python -m pip install --quiet -r test-requirements.txt || fail "installing the requirements failed; run again to retry"
    echo "$hash" > .venv/.vial-installed
fi

set +u # the activate script reads variables that may be unset
. .venv/bin/activate
set -u
python -c "import sys; print('Using Python', sys.version.split()[0], 'from', sys.executable)"

command -v npm >/dev/null || fail "npm not found: install Node 24 with npm 11"

# web/node_modules/.vial-package-lock.json is a copy of the package-lock.json last installed: when it differs, install
# again.
if ! cmp -s web/package-lock.json web/node_modules/.vial-package-lock.json; then
    echo "Installing the web UI's npm packages ..."
    (cd web && npm ci --no-audit --no-fund) || fail "npm ci failed"
    cp web/package-lock.json web/node_modules/.vial-package-lock.json
fi

echo "Building the web UI ..."
(cd web && npm run build) || fail "building the web UI failed"

echo "Building the executable ..."
python -m PyInstaller --noconfirm vial.spec || fail "building the executable failed"

echo "Checking that it runs ..."
python util/smoke_test.py dist/vial || fail "the smoke test failed"

echo
echo "Built: $(pwd)/dist/vial"
