# -*- mode: python -*-
# PyInstaller spec: Vial as one executable file, which unpacks itself to a temporary folder at start (one-file mode).
# Windows: dist/Vial.exe, a windowed app (no console: Vial shows an icon in the notification area instead) with Vial's
# icon and version info. Linux and macOS: dist/vial, run from a terminal, with the icon where the desktop has a tray.
#
# Build it from the repository root, once the web UI is built (see README.md):
#     cd web && npm ci && npm run build && cd ..
#     python -m PyInstaller vial.spec
#
# It refuses to build without the web UI (resources.pyinstaller_datas). Plain PyInstaller: no UPX, nothing stripped.
import os
import sys

ROOT = os.path.abspath(SPECPATH)  # noqa: F821 (PyInstaller defines SPECPATH)
PYTHON = os.path.join(ROOT, "src", "main", "python")
sys.path.insert(0, PYTHON)

import resources  # noqa: E402
import version  # noqa: E402

WINDOWS = sys.platform == "win32"

HIDDEN_IMPORTS = [
    # uvicorn picks its event loop, HTTP and WebSocket implementations and its logging by name at run time
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
    "uvicorn.lifespan.on",
    "websockets",
    # hidapi: hidproxy imports its hidraw backend on Linux, its default one elsewhere
    "hidraw" if sys.platform.startswith("linux") else "hid",
    # the tray icon (tray.py): pystray picks its backend by name at run time, and Pillow its plugin for Icon.ico
    "pystray._win32" if WINDOWS else "pystray._darwin" if sys.platform == "darwin" else "pystray._xorg",
    "PIL.IcoImagePlugin",
    # Linux: the StatusNotifierItem icon (statusnotifier.py) over dbus-fast, imported where it is used
    *(["dbus_fast.aio", "dbus_fast.service"] if sys.platform.startswith("linux") else []),
]

EXCLUDES = [
    # never imported by Vial; left out in case the build's Python has them
    "tkinter",
    "PyQt5",
    "pytest",
    # pystray's GTK and AppIndicator backends need the system's PyGObject, which the executable can't carry: it
    # takes the plain X11 backend on Linux (tray.py)
    "gi",
    "pystray._appindicator",
    "pystray._gtk",
    # the build's own tools, which PyInstaller's analysis otherwise pulls in through optional imports
    "setuptools",
    "pkg_resources",
    "PyInstaller",
]


def windows_version_info():
    from PyInstaller.utils.win32.versioninfo import (FixedFileInfo, StringFileInfo, StringStruct, StringTable,
                                                     VarFileInfo, VarStruct, VSVersionInfo)
    numbers = tuple(int(n) for n in version.VERSION.split(".")) + (0,)
    strings = [
        StringStruct("CompanyName", "Vial (web) fork of vial-gui"),
        StringStruct("FileDescription", version.PRODUCT),
        StringStruct("FileVersion", version.VERSION),
        StringStruct("InternalName", "Vial"),
        StringStruct("LegalCopyright", "Copyright (C) the Vial contributors. GPL-2.0-or-later."),
        StringStruct("OriginalFilename", "Vial.exe"),
        StringStruct("ProductName", version.PRODUCT),
        StringStruct("ProductVersion", version.VERSION),
    ]
    return VSVersionInfo(
        ffi=FixedFileInfo(filevers=numbers, prodvers=numbers),
        kids=[StringFileInfo([StringTable("040904B0", strings)]), VarFileInfo([VarStruct("Translation", [0x0409, 1200])])],
    )


a = Analysis(  # noqa: F821
    [os.path.join(PYTHON, "vial_web.py")],
    pathex=[PYTHON],
    datas=resources.pyinstaller_datas(),
    hiddenimports=HIDDEN_IMPORTS,
    excludes=EXCLUDES,
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Vial" if WINDOWS else "vial",
    # Windows: no console window; the tray icon stands in for it (--no-tray: the link is in vial.log, and printed to
    # whatever Vial's output is redirected to). Linux and macOS: a terminal program, as it is run from one.
    console=not WINDOWS,
    debug=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    icon=os.path.join(ROOT, "src", "main", "icons", "Icon.ico") if WINDOWS else None,
    version=windows_version_info() if WINDOWS else None,
)
