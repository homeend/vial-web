# SPDX-License-Identifier: GPL-2.0-or-later
""" `vial --self-check`: whether this build of Vial has everything it needs. hidapi is loaded, but never asked for any
device: no keyboard is looked for or opened. The CI's smoke test runs it on every built executable. """
import importlib
import json

import resources
import version

SERVER_MODULES = (
    "server.app",
    "simulator.corne",
    # what uvicorn picks by name when it runs (vial.spec's hidden imports)
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
    "uvicorn.lifespan.on",
)


def problems(import_module=importlib.import_module):
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
    print("{}: this build has everything it needs (hidapi, the server, the web UI, the QMK settings). No keyboard was "
          "looked for.".format(name))
    return 0
