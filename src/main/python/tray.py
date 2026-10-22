# SPDX-License-Identifier: GPL-2.0-or-later
""" Vial's icon in the notification area (the tray on Windows and Linux, the menu bar on macOS) while it runs.

The icon's menu has Open Vial (also what a click does, where the system lets an icon have a click action) and Quit
Vial, which stops Vial as Quit Vial on the page does. The icon is drawn by pystray; its loop must own the main thread
on macOS (AppKit) and does on every system here, so the server runs in a thread while the icon is shown (run()).

The tray is optional: when pystray or its libraries can't be loaded (a Linux without a display, or whose desktop has
no tray), or the icon can't be shown, Vial runs as it does without one, and says why in vial.log. On Linux the
executable carries pystray's plain X11 backend only: it shows on an X11 session whose panel takes XEmbed icons, and
it has no menu there (a click opens Vial; Quit is on the page). pystray's better Linux backends (GTK, AppIndicator)
need the system's PyGObject, which Vial uses when running from source and it is installed.

The icon's image is Vial's round logo (Icon.ico) on a light square with rounded corners (square()): the dark round
logo alone sank into a dark panel.
"""
import logging
import signal
import sys
import threading

import resources

log = logging.getLogger(__name__)

OPEN = "Open Vial"
QUIT = "Quit Vial"
ICON_NAME = "vial"
STILL_RUNNING = "Vial is still running. Click its icon to open it again, or Quit Vial to stop it."
""" the notification when the last browser tab closes, where the icon can show one """
UNAVAILABLE = "no tray icon: %s"
""" logged (information) when Vial runs without the icon, with why """
IMAGE_SIDE = 256
""" the tray image's side in pixels: the system scales it to its icon size """
IMAGE_BACKGROUND = (226, 231, 238, 255)
""" the light square behind the logo (RGBA): light enough to stand out on a dark panel, grey enough on a light one """
IMAGE_CORNER = 0.18
""" the square's corner radius, as a fraction of its side """
IMAGE_MARGIN = 0.06
""" the logo's margin inside the square on each side, as a fraction of the side """
POSIX_STOP_SIGNALS = ("SIGINT", "SIGTERM", "SIGHUP")
""" what stops Vial while the icon's loop holds the main thread: Ctrl+C, kill or log-out, the terminal closed. The
loop is native code (AppKit's, GTK's), where Python's own signal handlers don't get to run: these are taken by a
thread of their own instead (see run()). A signal ignored by what started Vial (nohup) stays ignored. """


def load():
    """ (pystray, PIL.Image) when the tray libraries can be loaded here, else (None, why not) """
    try:
        import pystray
        from PIL import Image
    except Exception as e:
        # ImportError (not installed, or no backend for this system), or pystray's X11 backend failing to open the
        # display as it is imported (no DISPLAY: a Wayland session, a headless Linux)
        return None, "{}: {}".format(e.__class__.__name__, e) if str(e) else e.__class__.__name__
    return (pystray, Image), None


def square(logo, Image):
    """ The tray's image: logo (a PIL image, Vial's round logo) on a light square with rounded corners, IMAGE_SIDE
    pixels a side; Image is PIL.Image (from load()) """
    from PIL import ImageDraw
    image = Image.new("RGBA", (IMAGE_SIDE, IMAGE_SIDE), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle((0, 0, IMAGE_SIDE - 1, IMAGE_SIDE - 1),
                                            radius=round(IMAGE_SIDE * IMAGE_CORNER), fill=IMAGE_BACKGROUND)
    margin = round(IMAGE_SIDE * IMAGE_MARGIN)
    inner = IMAGE_SIDE - 2 * margin
    image.alpha_composite(logo.convert("RGBA").resize((inner, inner), Image.Resampling.LANCZOS), (margin, margin))
    return image


def keep_out_of_the_dock():
    """ macOS: Vial is a menu bar item only, not an application in the Dock (it has no window of its own) """
    if sys.platform != "darwin":
        return
    try:
        import AppKit
        AppKit.NSApplication.sharedApplication().setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
    except Exception as e:
        log.warning("Vial may show in the Dock: %s", e)


def make(title, open_vial, quit_vial):
    """ The tray icon, not yet shown: run() shows it. open_vial() opens Vial in the browser (Open Vial, or a click);
    quit_vial() stops Vial (Quit Vial). None, with why logged, when there can be no icon here. """
    loaded, problem = load()
    if loaded is None:
        log.info(UNAVAILABLE, problem)
        return None
    pystray, Image = loaded
    try:
        logo = Image.open(resources.path(resources.ICON))
        logo.load()
        image = square(logo, Image)
        keep_out_of_the_dock()
        menu = pystray.Menu(pystray.MenuItem(OPEN, lambda icon, item: open_vial(), default=True),
                            pystray.MenuItem(QUIT, lambda icon, item: quit_vial()))
        return pystray.Icon(ICON_NAME, image, title, menu)
    except Exception as e:
        log.warning(UNAVAILABLE, "{}: {}".format(e.__class__.__name__, e), exc_info=True)
        return None


def notify(icon, message):
    """ A notification from the icon, where the system shows them (not pystray's plain X11 backend); errors are
    logged, never raised: it is a courtesy """
    if icon is None or not getattr(icon, "HAS_NOTIFICATION", False):
        return
    try:
        icon.notify(message)
    except Exception as e:
        log.warning("the tray icon could not show a notification: %s", e)


class _StopSignals:
    """ with _StopSignals(stop): ... -- on Linux and macOS, while inside, each of POSIX_STOP_SIGNALS calls stop() from
    a thread of its own. The signals are blocked for every thread (the server's thread inherits the block) and taken
    with sigwait() instead, which works while the main thread is inside a native event loop. Nothing on Windows, where
    console events reach Vial through console.StopOnConsoleClose. """

    def __init__(self, stop):
        self.stop = stop
        self.signals = set()
        self.previous_mask = None
        self.thread = None
        """ the thread waiting for the signals, once entered on a POSIX system """

    def __enter__(self):
        if not hasattr(signal, "pthread_sigmask") or not hasattr(signal, "sigwait"):
            return self
        for name in POSIX_STOP_SIGNALS:
            signum = getattr(signal, name, None)
            if signum is not None and signal.getsignal(signum) is not signal.SIG_IGN:
                self.signals.add(signum)
        if not self.signals:
            return self
        self.previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, self.signals)
        self.thread = threading.Thread(target=self._wait, name="stop signals", daemon=True)
        self.thread.start()
        return self

    def _wait(self):
        try:
            signum = signal.sigwait(self.signals)
        except Exception as e:  # pragma: no cover - the platform refusing: nothing more can be done
            log.warning("could not wait for the stop signals: %s", e)
            return
        log.info("signal %s: Vial is stopping", signal.Signals(signum).name)
        self.stop()

    def __exit__(self, *exc):
        if self.previous_mask is not None:
            # the waiting thread keeps its own mask and ends with the process; the main thread handles signals again
            signal.pthread_sigmask(signal.SIG_SETMASK, self.previous_mask)
        return False


def run(icon, serve, stop):
    """ Show the icon while serve() runs. serve() runs in a thread of its own and the icon's loop in this one, the
    main thread, until serve() returns; stop() asks serve() to return (Quit Vial on the icon's menu does this, and so
    do Ctrl+C and the stop signals). Whatever serve() raised is raised here once the icon is gone, and so is a
    KeyboardInterrupt that reached this thread. """
    started, done, outcome = threading.Event(), threading.Event(), []

    def setup(icon):
        # pystray runs this in a thread once its loop is ready, so that icon.stop() always reaches a running loop
        started.set()
        icon.visible = True
        try:
            serve()
        except BaseException as e:
            outcome.append(e)
        finally:
            done.set()
            icon.stop()

    interrupted = False
    with _StopSignals(stop):
        try:
            icon.run(setup=setup)
        except KeyboardInterrupt:
            interrupted = True
        except Exception:
            if not started.is_set():
                # the icon couldn't be shown and nothing has run yet: as without an icon, in this thread
                log.warning(UNAVAILABLE + "; Vial runs without it", "its loop failed", exc_info=True)
                serve()
                return
            log.warning("the tray icon's loop failed; Vial keeps running without the icon", exc_info=True)
        if not started.is_set():
            if interrupted:
                raise KeyboardInterrupt
            # the loop returned without ever running setup: nothing has served yet, so serve here, as without an icon
            log.warning(UNAVAILABLE + "; Vial runs without it", "its loop ended at once")
            serve()
            return
        if interrupted:
            stop()
        while not done.wait(0.5):  # waiting in slices: Ctrl+C reaches a wait on Windows only between them
            pass
    try:
        icon.visible = False  # a loop left by an exception would leave the icon behind
    except Exception:
        pass
    if outcome:
        raise outcome[0]
    if interrupted:
        raise KeyboardInterrupt
