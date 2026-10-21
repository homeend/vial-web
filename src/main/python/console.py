# SPDX-License-Identifier: GPL-2.0-or-later
""" Closing Vial's console window stops it cleanly, as Ctrl+C does: the server stops and the keyboard is let go of.

Ctrl+C reaches Python as KeyboardInterrupt, and uvicorn stops on it. On Windows a console window being closed (or
logging off, shutting down) doesn't: Windows ends the process as soon as its console handlers return, or at the latest
5 seconds after the event. The handler installed here asks the server to stop and waits, up to CLOSE_WAIT seconds,
until Vial has let go of the keyboard (released()). Ctrl+Break is taken here too: uvicorn would stop on it, then end the
process with it before the keyboard is closed. Elsewhere a terminal closed sends SIGHUP, which would end the process at
once: it asks the server to stop instead.
"""
import signal
import sys
import threading

CTRL_C_EVENT = 0
CTRL_BREAK_EVENT = 1
CTRL_CLOSE_EVENT = 2
CTRL_LOGOFF_EVENT = 5
CTRL_SHUTDOWN_EVENT = 6
ENDING_EVENTS = (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT)
""" the process is ended once the handlers return """
CLOSE_WAIT = 4.5
""" seconds a close waits for Vial to stop: Windows ends the process 5 seconds after the event anyway """


class ConsoleStop:
    """ What a console event does: stop() asks the server to stop (from any thread), and the event's handler waits for
    released() before it lets the process end """

    def __init__(self, stop, wait=CLOSE_WAIT):
        self.stop = stop
        self.wait = wait
        self.done = threading.Event()

    def handle(self, event):
        """ The console control handler: True when the event is taken here (no other handler sees it) """
        if event == CTRL_BREAK_EVENT:
            self.stop()
            return True
        if event in ENDING_EVENTS:
            self.stop()
            self.done.wait(self.wait)
            return True
        return False  # Ctrl+C: Python's KeyboardInterrupt, which uvicorn stops on

    def released(self):
        """ Vial has stopped and let go of the keyboard: a close waiting for it lets the process end """
        self.done.set()


class _Installed:
    """ A ConsoleStop installed as a console control handler, until uninstall() """

    def __init__(self, console_stop):
        import ctypes
        from ctypes import wintypes
        self.console_stop = console_stop
        routine = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel32.SetConsoleCtrlHandler.argtypes = (routine, wintypes.BOOL)
        self.kernel32.SetConsoleCtrlHandler.restype = wintypes.BOOL
        # Ctrl+C reaches Vial even if what started it ignored Ctrl+C, which a process inherits
        self.kernel32.SetConsoleCtrlHandler(routine(), False)  # routine(): no routine (NULL)
        # kept: Windows calls it for as long as it is installed
        self.routine = routine(lambda event: bool(console_stop.handle(event)))
        if not self.kernel32.SetConsoleCtrlHandler(self.routine, True):
            raise ctypes.WinError(ctypes.get_last_error())

    def uninstall(self):
        self.kernel32.SetConsoleCtrlHandler(self.routine, False)


class StopOnConsoleClose:
    """ with StopOnConsoleClose(stop): ... -- while inside, closing the console window calls stop(), and on Windows
    waits for the block to end (at most CLOSE_WAIT seconds) before the process is ended. Entered in the main thread
    (where Python handles signals). """

    def __init__(self, stop, wait=CLOSE_WAIT):
        self.console_stop = ConsoleStop(stop, wait)
        self.installed = None
        self.hangup = False
        self.previous_hangup = None

    def __enter__(self):
        if sys.platform == "win32":
            self.installed = _Installed(self.console_stop)
        elif hasattr(signal, "SIGHUP"):
            self.previous_hangup = signal.signal(signal.SIGHUP, lambda signum, frame: self.console_stop.stop())
            self.hangup = True
        return self.console_stop

    def __exit__(self, *exc):
        self.console_stop.released()
        if self.installed is not None:
            self.installed.uninstall()
        if self.hangup:
            signal.signal(signal.SIGHUP, self.previous_hangup or signal.SIG_DFL)
        return False
