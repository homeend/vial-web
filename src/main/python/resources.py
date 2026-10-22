# SPDX-License-Identifier: GPL-2.0-or-later
""" Where Vial's bundled files are: the built web UI and the QMK settings definitions.

From source they are read from the repository. In the one-file executable they are read from the folder PyInstaller
unpacks it to at start (sys._MEIPASS), where vial.spec puts each one at its `bundled` path. That folder is temporary:
user data never goes there, nor next to the executable (see vial_web.data_dir).
"""
import os
import sys
from typing import NamedTuple

SOURCE_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
""" the repository's root, when running from source """


class Resource(NamedTuple):
    source: str
    """ where it is in the repository, '/'-separated """
    bundled: str
    """ where it is in the one-file executable's unpacked folder, '/'-separated """


WEB_DIST = Resource("web/dist", "web")
""" the built web UI (cd web && npm ci && npm run build) """
QMK_SETTINGS = Resource("src/main/resources/base/qmk_settings.json", "qmk_settings.json")
""" the QMK settings Vial knows, grouped as the Settings page shows them """
ICON = Resource("src/main/icons/Icon.ico", "Icon.ico")
""" Vial's icon, shown in the notification area while it runs (tray.py); on Windows it is the executable's too """
BUNDLED = (WEB_DIST, QMK_SETTINGS, ICON)
""" every file or folder vial.spec bundles """


def is_frozen():
    """ Whether this is a PyInstaller build, such as the one-file executable: PyInstaller sets sys.frozen, and
    sys._MEIPASS to the folder holding the bundled files (the one-file executable unpacks them there at start) """
    return bool(getattr(sys, "frozen", False)) and getattr(sys, "_MEIPASS", None) is not None


def source_path(resource):
    """ The resource's path in the repository """
    return os.path.join(SOURCE_ROOT, *resource.source.split("/"))


def path(resource):
    """ The resource's path: in the unpacked executable when frozen, else in the repository """
    if is_frozen():
        return os.path.join(sys._MEIPASS, *resource.bundled.split("/"))
    return source_path(resource)


WEB_BUILD_HINT = "build it first: cd web && npm ci && npm run build"


def _web_ui_missing_in(folder):
    index = os.path.join(folder, "index.html")
    if os.path.isfile(index):
        return None
    return "the web UI isn't built ({} is missing): {}".format(os.path.normpath(index), WEB_BUILD_HINT)


def web_ui_missing():
    """ Why the built web UI can't be served (a message saying how to build it), or None when it is there """
    return _web_ui_missing_in(path(WEB_DIST))


def pyinstaller_datas():
    """ vial.spec's `datas`, from the repository: (path in the repository, folder in the bundle) for each resource. A
    folder is copied into the folder of its bundled path, a file into the folder its bundled path names ("." for the
    top). FileNotFoundError when one is missing, so that an executable is never built without it. """
    problem = _web_ui_missing_in(source_path(WEB_DIST))
    if problem:
        raise FileNotFoundError(problem)
    datas = []
    for resource in BUNDLED:
        source = source_path(resource)
        if not os.path.exists(source):
            raise FileNotFoundError("{} is missing".format(os.path.normpath(source)))
        if os.path.isdir(source):
            datas.append((source, resource.bundled))
        else:
            datas.append((source, os.path.dirname(resource.bundled) or "."))
    return datas
