"""Build helper: runs the fbs command line, as `fbs`, without fbs 0.9's copying of old Visual C++ runtimes on Windows.

    python util/fbs_build.py freeze      (from the repository root, with the build venv active)

On Windows, `fbs freeze` ends with fbs.freeze.windows._add_missing_dlls, which copies msvcr100.dll, msvcr110.dll,
msvcp110.dll, ... from PATH into the frozen app and fails when the Visual C++ 2010/2012 redistributables aren't
installed. That was a workaround for Python 3.6 and PyInstaller 3.4; Python 3.13 doesn't use those runtimes, and
PyInstaller 6 bundles the ones the app does need (vcruntime140.dll, the Qt DLLs' msvcp140.dll). So that step is
skipped, and everything else (`freeze`, `installer`, ...) runs as fbs does it.

Removed in phase 6, with fbs and the Qt UI.
"""
import sys

import fbs.__main__

if sys.platform == "win32":
    import fbs.freeze.windows

    # freeze_windows() looks the function up in its module when it runs, so this replaces the step
    fbs.freeze.windows._add_missing_dlls = lambda: None

if __name__ == "__main__":
    fbs.__main__._main()
