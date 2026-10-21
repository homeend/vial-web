import signal
import sys
import threading
import time

import pytest

import console


def test_ctrl_c_is_left_to_python():
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True))
    assert stop.handle(console.CTRL_C_EVENT) is False
    assert stops == []


def test_ctrl_break_stops_the_server_and_lets_the_process_run_on():
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True), wait=60)
    started = time.monotonic()
    assert stop.handle(console.CTRL_BREAK_EVENT) is True
    assert time.monotonic() - started < 5  # doesn't wait for anything: the process isn't ended
    assert stops == [True]


@pytest.mark.parametrize("event", console.ENDING_EVENTS)
def test_closing_the_console_waits_until_vial_has_let_go_of_the_keyboard(event):
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True), wait=60)
    handled = []
    handler = threading.Thread(target=lambda: handled.append(stop.handle(event)))
    handler.start()
    handler.join(0.2)
    assert handler.is_alive()  # Windows ends the process once it returns: not yet
    assert stops == [True]
    stop.released()
    handler.join(5)
    assert handled == [True]


def test_closing_the_console_waits_only_so_long():
    stop = console.ConsoleStop(lambda: None, wait=0.05)
    assert stop.handle(console.CTRL_CLOSE_EVENT) is True


def test_unknown_events_are_left_to_others():
    stop = console.ConsoleStop(lambda: pytest.fail("stopped"))
    assert stop.handle(3) is False


def test_leaving_the_block_releases_a_close_waiting_for_it():
    with console.StopOnConsoleClose(lambda: None, wait=60) as stop:
        assert not stop.done.is_set()
    assert stop.done.is_set()


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no SIGHUP")
def test_a_closed_terminal_stops_the_server_and_the_signal_is_handled_as_before_afterwards():
    before = signal.getsignal(signal.SIGHUP)
    stops = []
    with console.StopOnConsoleClose(lambda: stops.append(True)):
        signal.getsignal(signal.SIGHUP)(signal.SIGHUP, None)
        assert stops == [True]
    assert signal.getsignal(signal.SIGHUP) == before


@pytest.mark.skipif(sys.platform != "win32", reason="the console handler is Windows'")
def test_the_console_handler_is_installed_while_in_the_block_and_removed_after(monkeypatch):
    installed = []
    real = console._Installed

    class Recorded(real):
        def __init__(self, console_stop):
            super().__init__(console_stop)
            installed.append(self)
            self.removed = False

        def uninstall(self):
            super().uninstall()
            self.removed = True
    monkeypatch.setattr(console, "_Installed", Recorded)
    stops = []
    with console.StopOnConsoleClose(lambda: stops.append(True)):
        (handler,) = installed
        assert not handler.removed
        # the routine Windows calls answers what ConsoleStop decides
        assert handler.routine(console.CTRL_C_EVENT) == 0 and stops == []
        assert handler.routine(console.CTRL_BREAK_EVENT) == 1 and stops == [True]
    assert handler.removed
