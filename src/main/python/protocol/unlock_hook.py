# SPDX-License-Identifier: GPL-2.0-or-later
""" How the protocol asks for the keyboard to be unlocked before a security-sensitive write.

The Qt app shows its unlock dialog (the default). Other front ends install their own handler.
"""

_handler = None


def set_unlock_handler(handler):
    """ Install handler(keyboard); pass None to restore the Qt unlock dialog """
    global _handler
    _handler = handler


def request_unlock(keyboard):
    if _handler is not None:
        return _handler(keyboard)
    from unlocker import Unlocker
    return Unlocker.unlock(keyboard)
