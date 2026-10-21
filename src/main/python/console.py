# SPDX-License-Identifier: GPL-2.0-or-later
""" Closing Vial's console window stops it cleanly, as Ctrl+C does: the server stops and the keyboard is let go of.

Ctrl+C reaches Python as KeyboardInterrupt, and uvicorn stops on it. On Windows a console window being closed doesn't:
Windows ends the process as soon as its console handlers return, or at the latest 5 seconds after the event. The
handler installed here asks the server to stop and waits, up to CLOSE_WAIT seconds, until Vial has let go of the
keyboard (released()). Ctrl+Break is taken here too: uvicorn would stop on it, then end the process with it before the
keyboard is closed. Log-off and shutdown never reach the handler: Windows doesn't send them to a process that has
loaded user32.dll, as ctypes does. At log-off or shutdown Windows ends Vial, and the system closes the keyboard's
handle.

Elsewhere a terminal closed sends SIGHUP, and log-out or kill sends SIGTERM. Each would end the process at once
(uvicorn takes SIGTERM while serving, but raises it again once it has stopped, before the keyboard is closed): both ask
the server to stop instead, unless what started Vial ignores them (nohup).
"""
import logging
import signal
import sys
import threading

CTRL_C_EVENT = 0
CTRL_BREAK_EVENT = 1
CTRL_CLOSE_EVENT = 2
CTRL_LOGOFF_EVENT = 5
CTRL_SHUTDOWN_EVENT = 6
ENDING_EVENTS = (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT)
""" the process is ended once the handlers return. Only the close reaches Vial: Windows sends log-off and shutdown only
to processes that haven't loaded user32.dll, and ctypes loads it. They are handled alike all the same. """
CLOSE_WAIT = 4.5
""" seconds a close waits for Vial to stop: Windows ends the process 5 seconds after the event anyway """
ENDING_SIGNALS = ("SIGHUP", "SIGTERM")
""" signals that end the process at once (a terminal closed; log-out or kill), where the platform has them """

_KEEP = []
""" every console control routine installed: Windows may still be calling one as it is removed, so none is freed """


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
        self.routine = routine(lambda event: bool(console_stop.handle(event)))
        _KEEP.append(self.routine)  # kept for good: Windows calls it while installed, and maybe as it is removed
        if not self.kernel32.SetConsoleCtrlHandler(self.routine, True):
            raise ctypes.WinError(ctypes.get_last_error())

    def uninstall(self):
        self.kernel32.SetConsoleCtrlHandler(self.routine, False)


class StopOnConsoleClose:
    """ with StopOnConsoleClose(stop): ... -- while inside, closing the console window or Ctrl+Break (Windows), or
    SIGHUP or SIGTERM (elsewhere), calls stop(). On Windows a close waits for the block to end (at most CLOSE_WAIT
    seconds) before the process is ended. Entered in the main thread (where Python handles signals). If the handlers
    can't be installed, that is logged and the block runs without them. """

    def __init__(self, stop, wait=CLOSE_WAIT):
        self.console_stop = ConsoleStop(stop, wait)
        self.installed = None
        self.previous_signals = {}

    def __enter__(self):
        try:
            if sys.platform == "win32":
                self.installed = _Installed(self.console_stop)
            else:
                self._take_signals()
        except Exception as e:
            # Ctrl+C and Quit Vial still stop it cleanly
            logging.warning("closing the console will end Vial at once: its handler could not be installed (%s)", e)
        return self.console_stop

    def _take_signals(self):
        for name in ENDING_SIGNALS:
            signum = getattr(signal, name, None)
            if signum is None or signal.getsignal(signum) is signal.SIG_IGN:
                continue  # nohup: what started Vial wants it to run on
            self.previous_signals[signum] = signal.signal(signum, lambda signum, frame: self.console_stop.stop())

    def __exit__(self, *exc):
        self.console_stop.released()
        if self.installed is not None:
            self.installed.uninstall()
        for signum, previous in self.previous_signals.items():
            signal.signal(signum, previous or signal.SIG_DFL)
        return False
