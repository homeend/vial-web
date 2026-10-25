# SPDX-License-Identifier: GPL-2.0-or-later
""" What this Vial is, for the Version page (GET /api/version): its version, whether it runs as the executable or
from source, the commit it was built from, how and when the executable was built, and where it runs.

vial.spec records the build (write) as build-info.json next to the bundled files; the executable reads it back
(read_bundled). From source, the checkout is asked (git_state) each time the page asks. Nothing here needs a
keyboard. """
import datetime
import json
import os
import platform
import subprocess
import sys
import time

import resources
import version

FILE_NAME = "build-info.json"
""" the build record, at the top of the executable's unpacked folder """
GIT_TIMEOUT = 10


def _git(root, *args):
    """ git's output for the checkout at root, stripped; None when git isn't there, root isn't a checkout, or the
    command fails """
    try:
        out = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=GIT_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def git_state(root):
    """ The checkout at root: {"commit": the full hash, "branch": its name (None when detached), "dirty": whether
    tracked files differ from the commit (None when unknown)}; None when git or the checkout isn't there """
    commit = _git(root, "rev-parse", "HEAD")
    if not commit:
        return None
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
    status = _git(root, "status", "--porcelain", "--untracked-files=no")
    return {"commit": commit, "branch": None if branch in (None, "", "HEAD") else branch,
            "dirty": None if status is None else status != ""}


def iso(seconds):
    """ A moment (seconds since the epoch) as an ISO 8601 UTC string, to the second """
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def describe(root, env=None, now=None):
    """ The build record for the checkout at root, built now: the fields of schemas.BuildInfo. env: the builder's
    environment (GitHub Actions names its run); now: seconds since the epoch """
    env = os.environ if env is None else env
    git = git_state(root) or {}
    run = env.get("GITHUB_RUN_ID") or None
    branch = git.get("branch") or (env.get("GITHUB_REF_NAME") or None if run else None)
    index = os.path.join(root, "web", "dist", "index.html")
    try:
        import PyInstaller
        pyinstaller = PyInstaller.__version__
    except Exception:
        pyinstaller = None
    return {
        "builtAt": iso(time.time() if now is None else now),
        "commit": git.get("commit"),
        "branch": branch,
        "dirty": git.get("dirty"),
        "ciRun": run,
        "ciUrl": "{}/{}/actions/runs/{}".format(env.get("GITHUB_SERVER_URL", "https://github.com"),
                                                env.get("GITHUB_REPOSITORY", ""), run) if run else None,
        "ciRef": (env.get("GITHUB_REF_NAME") or None) if run else None,
        "runner": (env.get("RUNNER_OS") or None) if run else None,
        "builderSystem": platform.platform(),
        "builderPython": platform.python_version(),
        "pyinstaller": pyinstaller,
        "webUiBuiltAt": iso(os.path.getmtime(index)) if os.path.isfile(index) else None,
    }


def write(root, path, env=None, now=None):
    """ Writes the build record of the checkout at root to path (vial.spec, before PyInstaller bundles it) """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as out:
        json.dump(describe(root, env, now), out, indent=1)
        out.write("\n")


def read_bundled():
    """ The build record of this executable; None from source, or in an executable built without one (before this
    record existed), or when the file can't be read """
    if not resources.is_frozen():
        return None
    try:
        with open(os.path.join(sys._MEIPASS, FILE_NAME), encoding="utf-8") as inf:
            data = json.load(inf)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def info(started_at, fake, data_dir=None, log_file=None):
    """ What the Version page shows (schemas.VersionInfo): the product and version, the executable or the checkout,
    the commit (the checkout's from source, the build's from the executable), the build record, the Python and
    system this runs on, when it started (seconds since the epoch), whether the keyboard is simulated, and the data
    folder and log file (None when the server runs without them, as the tests do) """
    frozen = resources.is_frozen()
    build = read_bundled() if frozen else None
    git = (build or {}) if frozen else (git_state(resources.SOURCE_ROOT) or {})
    return {
        "product": version.PRODUCT,
        "version": version.VERSION,
        "kind": "executable" if frozen else "source",
        "executable": sys.executable if frozen else None,
        "sourceRoot": None if frozen else resources.SOURCE_ROOT,
        "commit": git.get("commit"),
        "branch": git.get("branch"),
        "dirty": git.get("dirty"),
        "build": build,
        "python": "{} {}".format(platform.python_implementation(), platform.python_version()),
        "platform": sys.platform,
        "system": platform.platform(),
        "startedAt": iso(started_at),
        "fake": fake,
        "dataDir": data_dir,
        "logFile": log_file,
    }
