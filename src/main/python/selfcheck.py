# SPDX-License-Identifier: GPL-2.0-or-later
""" `vial --self-check`: whether this build of Vial has everything it needs. hidapi is loaded, but no device is listed
or opened: no keyboard is looked for. The CI's smoke test runs it on every built executable. """
import importlib
import json
import sys

import resources
import tray
import version

SERVER_MODULES = (
    "server.app",
    "simulator.corne",
    # what uvicorn imports by name when it runs: its "auto" choices, and the implementations they pick here
    # (vial.spec's hidden imports)
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
    "uvicorn.lifespan.on",
)
LINUX_TRAY_MODULES = ("PIL.Image", "dbus_fast.service", "Xlib.display")
""" On Linux the tray's libraries are checked module by module: importing pystray itself opens the display, which a
Linux without one (the CI's runners) can't. Elsewhere the tray is loaded as Vial loads it (tray.load). """


def problems(import_module=importlib.import_module, platform=sys.platform, load_tray=tray.load):
    """ What this build lacks, one sentence each; empty when it has everything """
    found = []
    try:
        import_module("hidproxy")  # hidapi's extension: its hidraw backend on Linux
    except Exception as e:  # ImportError, or its native library failing to load
        found.append("hidapi can't be loaded: {}".format(e))
    for name in SERVER_MODULES:
        try:
            import_module(name)
        except Exception as e:
            found.append("{} can't be imported: {}".format(name, e))
    if platform.startswith("linux"):
        for name in LINUX_TRAY_MODULES:
            try:
                import_module(name)
            except Exception as e:
                found.append("the tray icon's {} can't be imported: {}".format(name, e))
    else:
        loaded, problem = load_tray()
        if loaded is None:
            found.append("the tray icon's libraries can't be loaded: {}".format(problem))
    missing = resources.web_ui_missing()
    if missing:
        found.append(missing)
    try:
        with open(resources.path(resources.QMK_SETTINGS), "r", encoding="utf-8") as inf:
            json.load(inf)
    except (OSError, ValueError) as e:
        found.append("the QMK settings can't be read: {}".format(e))
    return found


def main():
    """ Prints what this build lacks, if anything; returns the exit code """
    found = problems()
    name = "{} {}".format(version.PRODUCT, version.VERSION)
    if found:
        print("{}: this build is incomplete:".format(name))
        for problem in found:
            print("  - " + problem)
        return 1
    print("{}: this build has everything it needs (hidapi, the server, the web UI, the QMK settings, the tray icon's "
          "libraries). No keyboard was looked for.".format(name))
    return 0
