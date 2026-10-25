# SPDX-License-Identifier: GPL-2.0-or-later
""" A change counter per keyboard, kept while the server runs: the macros version (KeyboardModel.macros.version).

A tab saves the macros with the version its copy of them was read at (MacrosIn.expect); the server refuses the save
(409, code "macrosChanged") when the keyboard's macros were written since, by another tab, a layout file or an
arrange, so that a stale copy never overwrites them. The layers' order has its own counter (arranger.Arrangements). """
import threading


class Versions:
    def __init__(self):
        self._versions = {}
        self._lock = threading.Lock()

    def get(self, key):
        """ The keyboard's version: how many times its macros were written since the server started (0 at first);
        key: arranger.key_of """
        with self._lock:
            return self._versions.get(key, 0)

    def bump(self, key):
        """ The keyboard's macros were written (or read again from the keyboard): its next version """
        with self._lock:
            self._versions[key] = self._versions.get(key, 0) + 1
            return self._versions[key]
