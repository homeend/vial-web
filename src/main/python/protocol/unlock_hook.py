# SPDX-License-Identifier: GPL-2.0-or-later
""" How the protocol asks for the keyboard to be unlocked before a security-sensitive write: the server installs its
handler (server.device.require_unlocked), which refuses the write while the keyboard is locked.
"""

_handler = None


def set_unlock_handler(handler):
    """ Install handler(keyboard); None removes it.

    A handler must block until the keyboard is unlocked, or raise. If it returns without unlocking, the protocol
    goes on to send the write, which the firmware may silently reject. """
    global _handler
    _handler = handler


def request_unlock(keyboard):
    if _handler is None:
        raise RuntimeError("no unlock handler is installed (protocol.unlock_hook.set_unlock_handler)")
    return _handler(keyboard)
