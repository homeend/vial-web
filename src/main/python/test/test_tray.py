import builtins
import logging
import os
import signal
import sys
import threading
import types

import pytest

import resources
import tray


class FakeIcon:
    """ Stands in for a pystray Icon: run() runs the setup in a thread, as pystray does once its loop is ready, and
    blocks until stop() (or raises what a test planted) """
    HAS_NOTIFICATION = True

    def __init__(self, raise_in_run=None, before_setup=False):
        self.visible = False
        self.stopped = threading.Event()
        self.notifications = []
        self.ran_in = None
        self.setup_thread = None
        self.visible_while_serving = None
        self.raise_in_run = raise_in_run
        self.before_setup = before_setup

    def run(self, setup=None):
        self.ran_in = threading.current_thread()
        if self.raise_in_run is not None and self.before_setup:
            raise self.raise_in_run
        self.setup_thread = threading.Thread(target=setup, args=[self], name="fake setup")
        self.setup_thread.start()
        if self.raise_in_run is not None:
            threading.Event().wait(0.05)  # the setup is under way
            raise self.raise_in_run
        self.stopped.wait()

    def stop(self):
        self.stopped.set()

    def notify(self, message, title=None):
        self.notifications.append(message)


class Serving:
    """ A serve() for the tests: records where it ran, and returns once stop() is called (or at once) """

    def __init__(self, icon, wait_for_stop=False, raise_at_end=None):
        self.icon = icon
        self.ran_in = None
        self.stop_asked = threading.Event()
        self.wait_for_stop = wait_for_stop
        self.raise_at_end = raise_at_end
        self.calls = 0

    def __call__(self):
        self.calls += 1
        self.ran_in = threading.current_thread()
        self.icon.visible_while_serving = self.icon.visible
        if self.wait_for_stop:
            assert self.stop_asked.wait(5), "stop() was never called"
        if self.raise_at_end is not None:
            raise self.raise_at_end

    def stop(self):
        self.stop_asked.set()


# ---------- run() ----------

def test_the_server_runs_in_a_thread_while_the_icon_holds_the_main_thread():
    icon = FakeIcon()
    serve = Serving(icon)
    tray.run(icon, serve, serve.stop)
    assert icon.ran_in is threading.main_thread()
    assert serve.ran_in is icon.setup_thread  # pystray's setup thread
    assert icon.visible_while_serving is True
    assert icon.stopped.is_set() and icon.visible is False


def test_what_the_server_raised_is_raised_once_the_icon_is_gone():
    icon = FakeIcon()
    serve = Serving(icon, raise_at_end=RuntimeError("bind failed"))
    with pytest.raises(RuntimeError, match="bind failed"):
        tray.run(icon, serve, serve.stop)
    assert icon.stopped.is_set() and icon.visible is False


def test_ctrl_c_in_the_main_thread_stops_the_server_and_is_raised_again():
    icon = FakeIcon(raise_in_run=KeyboardInterrupt())
    serve = Serving(icon, wait_for_stop=True)
    with pytest.raises(KeyboardInterrupt):
        tray.run(icon, serve, serve.stop)
    assert serve.stop_asked.is_set()
    assert serve.calls == 1
    assert icon.visible is False


def test_ctrl_c_before_the_icon_is_ready_never_serves():
    icon = FakeIcon(raise_in_run=KeyboardInterrupt(), before_setup=True)
    serve = Serving(icon)
    with pytest.raises(KeyboardInterrupt):
        tray.run(icon, serve, serve.stop)
    assert serve.calls == 0


def test_an_icon_that_cannot_be_shown_serves_in_the_main_thread(caplog):
    icon = FakeIcon(raise_in_run=OSError("no tray"), before_setup=True)
    serve = Serving(icon)
    with caplog.at_level(logging.WARNING):
        tray.run(icon, serve, serve.stop)
    assert serve.calls == 1 and serve.ran_in is threading.main_thread()
    assert "Vial runs without it" in caplog.text and "no tray" in caplog.text


def test_an_icon_loop_that_fails_while_serving_keeps_vial_running(caplog):
    icon = FakeIcon(raise_in_run=OSError("loop failed"))
    serve = Serving(icon, wait_for_stop=True)
    timer = threading.Timer(0.3, serve.stop)  # Quit Vial on the page, say
    timer.start()
    with caplog.at_level(logging.WARNING):
        tray.run(icon, serve, serve.stop)
    assert serve.calls == 1 and serve.ran_in is icon.setup_thread
    assert "keeps running without the icon" in caplog.text


def test_an_icon_loop_that_returns_at_once_serves_in_the_main_thread(caplog):
    class ReturnsAtOnce(FakeIcon):
        def run(self, setup=None):
            self.ran_in = threading.current_thread()
    icon = ReturnsAtOnce()
    serve = Serving(icon)
    with caplog.at_level(logging.WARNING):
        tray.run(icon, serve, serve.stop)
    assert serve.calls == 1 and serve.ran_in is threading.main_thread()
    assert "ended at once" in caplog.text


# ---------- the stop signals ----------

@pytest.mark.skipif(not hasattr(signal, "sigwait"), reason="POSIX only: Windows has console events instead")
def test_a_stop_signal_calls_stop_from_a_thread_while_the_main_thread_is_busy():
    stopped = threading.Event()
    before = signal.pthread_sigmask(signal.SIG_BLOCK, set())
    with tray._StopSignals(stopped.set) as taken:
        assert signal.SIGTERM in signal.pthread_sigmask(signal.SIG_BLOCK, set())  # blocked here, taken by the thread
        # sent to the waiting thread itself: in Vial every thread is started after the block and inherits it, but
        # the test runner's own threads (pytest-xdist's) don't block SIGTERM, and a signal sent to the whole process
        # could end the runner through one of them
        signal.pthread_kill(taken.thread.ident, signal.SIGTERM)
        assert stopped.wait(5)
    assert signal.pthread_sigmask(signal.SIG_BLOCK, set()) == before


@pytest.mark.skipif(not hasattr(signal, "sigwait"), reason="POSIX only")
def test_a_signal_ignored_by_what_started_vial_stays_ignored(monkeypatch):
    monkeypatch.setattr(signal, "getsignal", lambda signum: signal.SIG_IGN if signum == signal.SIGHUP else None)
    with tray._StopSignals(lambda: None) as taken:
        assert signal.SIGHUP not in taken.signals
        assert signal.SIGTERM in taken.signals


def test_the_stop_signals_are_nothing_on_windows(monkeypatch):
    monkeypatch.delattr(signal, "sigwait", raising=False)
    with tray._StopSignals(lambda: None) as taken:
        assert taken.signals == set() and taken.previous_mask is None


# ---------- make() ----------

class FakePystray(types.ModuleType):
    """ A pystray module: records the Icon, its menu and its items """

    def __init__(self):
        super().__init__("pystray")
        module = self

        class MenuItem:
            def __init__(self, text, action, default=False):
                self.text, self.action, self.default = text, action, default

        class Menu:
            def __init__(self, *items):
                self.items = items

        class Icon:
            def __init__(self, name, image, title, menu):
                self.name, self.image, self.title, self.menu = name, image, title, menu
                module.icons.append(self)
        self.icons = []
        self.MenuItem, self.Menu, self.Icon = MenuItem, Menu, Icon


@pytest.fixture
def fake_pystray(monkeypatch):
    module = FakePystray()
    monkeypatch.setitem(sys.modules, "pystray", module)
    return module


def test_the_icon_has_vials_image_and_a_menu_that_opens_and_quits(fake_pystray, monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    opened, quit_used = [], []
    icon = tray.make("Vial (simulated keyboard)", lambda: opened.append(True), lambda: quit_used.append(True))
    assert icon is fake_pystray.icons[0]
    assert icon.name == tray.ICON_NAME and icon.title == "Vial (simulated keyboard)"
    assert icon.image.size == (tray.IMAGE_SIDE, tray.IMAGE_SIDE)  # square(): src/main/icons/Icon.ico on the square
    assert icon.image.getpixel((2, tray.IMAGE_SIDE // 2)) == tray.IMAGE_BACKGROUND
    open_item, quit_item = icon.menu.items
    assert (open_item.text, open_item.default) == (tray.OPEN, True)  # a click on the icon opens Vial
    assert (quit_item.text, quit_item.default) == (tray.QUIT, False)
    open_item.action(icon, open_item)
    quit_item.action(icon, quit_item)
    assert opened == [True] and quit_used == [True]


def test_the_tray_image_is_the_round_logo_on_a_light_square_with_rounded_corners():
    from PIL import Image
    logo = Image.open(resources.path(resources.ICON))
    assert logo.getpixel((0, 0))[3] == 0  # the logo is round: transparent outside the disk
    image = tray.square(logo, Image)
    side = tray.IMAGE_SIDE
    assert image.size == (side, side) and image.mode == "RGBA"
    assert image.getpixel((0, 0))[3] == 0  # the corners are rounded off
    assert image.getpixel((2, side // 2)) == tray.IMAGE_BACKGROUND  # the square's edge, where the logo was transparent
    assert image.getpixel((side // 2, 2)) == tray.IMAGE_BACKGROUND
    centre = image.getpixel((side // 2, side // 2))
    assert centre[3] == 255 and centre[2] > centre[0] + 50  # the logo's blue, over the square
    assert logo.size == (256, 256)  # the logo isn't changed


def test_on_linux_vials_own_statusnotifier_icon_comes_first(fake_pystray, monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    made, opened, quit_used = [], [], []
    own = object()

    def make(name, image, title, items):
        made.append((name, image, title, items))
        return own, None
    monkeypatch.setattr(tray.statusnotifier, "make", make)
    assert tray.make("Vial", lambda: opened.append(True), lambda: quit_used.append(True)) is own
    name, image, title, items = made[0]
    assert (name, title, image.size) == (tray.ICON_NAME, "Vial", (tray.IMAGE_SIDE, tray.IMAGE_SIDE))
    assert [(item.label, item.default) for item in items] == [(tray.OPEN, True), (tray.QUIT, False)]
    items[0].action()
    items[1].action()
    assert opened == [True] and quit_used == [True]
    assert fake_pystray.icons == []  # pystray wasn't asked


def test_on_linux_without_a_statusnotifier_host_pystrays_icon_is_used(fake_pystray, monkeypatch, caplog):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(tray.statusnotifier, "make", lambda name, image, title, items: (None, "no watcher"))
    with caplog.at_level(logging.INFO):
        icon = tray.make("Vial", lambda: None, lambda: None)
    assert icon is fake_pystray.icons[0]
    assert "no StatusNotifier tray icon: no watcher; trying pystray" in caplog.text


def test_elsewhere_the_statusnotifier_icon_is_not_asked_for(fake_pystray, monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")

    def not_here(*args):
        raise AssertionError("statusnotifier.make called off Linux")
    monkeypatch.setattr(tray.statusnotifier, "make", not_here)
    assert tray.make("Vial", lambda: None, lambda: None) is fake_pystray.icons[0]


def test_the_icons_image_is_bundled():
    assert resources.ICON in resources.BUNDLED
    assert os.path.isfile(resources.path(resources.ICON))


def test_on_macos_vial_stays_out_of_the_dock(fake_pystray, monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    policies = []

    class App:
        def setActivationPolicy_(self, policy):
            policies.append(policy)
    appkit = types.ModuleType("AppKit")
    appkit.NSApplicationActivationPolicyAccessory = 1
    appkit.NSApplication = types.SimpleNamespace(sharedApplication=App)
    monkeypatch.setitem(sys.modules, "AppKit", appkit)
    assert tray.make("Vial", lambda: None, lambda: None) is not None
    assert policies == [1]


def test_elsewhere_appkit_is_never_touched(fake_pystray, monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setitem(sys.modules, "AppKit", None)  # importing it would fail
    assert tray.make("Vial", lambda: None, lambda: None) is not None


def test_without_pystray_there_is_no_icon_and_the_log_says_so(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, "pystray", None)
    with caplog.at_level(logging.INFO):
        assert tray.make("Vial", lambda: None, lambda: None) is None
    assert "no tray icon: ModuleNotFoundError" in caplog.text


def test_pystray_failing_to_import_for_any_reason_means_no_icon(monkeypatch, caplog):
    """ pystray's X11 backend opens the display as it is imported: no DISPLAY (Wayland, headless) isn't an
    ImportError """
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "pystray":
            raise RuntimeError("Can't connect to display \":0\"")
        return real_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", failing_import)
    with caplog.at_level(logging.INFO):
        assert tray.make("Vial", lambda: None, lambda: None) is None
    assert "no tray icon: RuntimeError: Can't connect to display" in caplog.text


def test_an_icon_that_cannot_be_made_means_no_icon(fake_pystray, monkeypatch, caplog):
    monkeypatch.setattr(sys, "platform", "win32")

    def refuse(*args, **kwargs):
        raise OSError("no window class")
    fake_pystray.Icon = refuse
    with caplog.at_level(logging.WARNING):
        assert tray.make("Vial", lambda: None, lambda: None) is None
    assert "no tray icon: OSError: no window class" in caplog.text


def test_load_never_raises():
    """ on this system: the real libraries, or (on a Linux without a display) why they can't be loaded """
    loaded, problem = tray.load()
    assert (loaded is None) != (problem is None)


# ---------- notify() ----------

def test_a_notification_goes_to_the_icon_where_it_can_show_one():
    icon = FakeIcon()
    tray.notify(icon, "still running")
    assert icon.notifications == ["still running"]
    tray.notify(None, "still running")  # no icon: nothing


def test_an_icon_without_notifications_is_left_alone():
    icon = FakeIcon()
    icon.HAS_NOTIFICATION = False
    tray.notify(icon, "still running")
    assert icon.notifications == []


def test_a_notification_failing_is_logged_only(caplog):
    icon = FakeIcon()

    def fail(message, title=None):
        raise OSError("no notification daemon")
    icon.notify = fail
    with caplog.at_level(logging.WARNING):
        tray.notify(icon, "still running")
    assert "no notification daemon" in caplog.text
