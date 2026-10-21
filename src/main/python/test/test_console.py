import gc
import logging
import signal
import sys
import threading
import time
import weakref

import pytest
import uvicorn

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
    """ only the close arrives in practice (see console.ENDING_EVENTS); log-off and shutdown are handled alike """
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True), wait=60)
    handled = []
    handler = threading.Thread(target=lambda: handled.append(stop.handle(event)), daemon=True)
    handler.start()
    try:
        handler.join(0.2)
        assert handler.is_alive()  # Windows ends the process once it returns: not yet
        assert stops == [True]
    finally:
        stop.released()  # a failed check doesn't leave the handler waiting
    handler.join(5)
    assert handled == [True]


def test_closing_the_console_waits_only_so_long():
    stop = console.ConsoleStop(lambda: None, wait=0.2)
    started = time.monotonic()
    assert stop.handle(console.CTRL_CLOSE_EVENT) is True
    assert 0.1 < time.monotonic() - started < 5


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
    assert handler.routine in console._KEEP  # Windows may still be calling it as it is removed: never freed
    assert handler.routine(console.CTRL_BREAK_EVENT) == 0 and stops == [True]  # removed: left to the next handler


@pytest.mark.skipif(sys.platform != "win32", reason="the console handler is Windows'")
def test_a_removed_console_handler_keeps_nothing_of_vial_alive():
    """ _KEEP holds every routine for good: once removed, a routine must not hold the server (and its keyboard) """
    class Stop:
        def __call__(self):
            pass
    stop = Stop()
    alive = weakref.ref(stop)
    with console.StopOnConsoleClose(stop):
        pass
    del stop
    gc.collect()
    assert alive() is None


@pytest.mark.skipif(sys.platform != "win32", reason="the console handler is Windows'")
def test_a_console_handler_windows_refuses_is_logged_and_vial_runs_on_without_it(monkeypatch, caplog):
    def refused(console_stop):
        raise OSError(87, "The parameter is incorrect")
    monkeypatch.setattr(console, "_Installed", refused)
    stops = []
    with caplog.at_level(logging.WARNING):
        with console.StopOnConsoleClose(lambda: stops.append(True)) as stop:
            assert stop.handle(console.CTRL_BREAK_EVENT) is True and stops == [True]
    assert stop.done.is_set()
    assert "The parameter is incorrect" in caplog.text


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no SIGHUP")
def test_signal_handlers_that_cannot_be_installed_are_logged_and_vial_runs_on_without_them(caplog):
    before = {signum: signal.getsignal(signum) for signum in (signal.SIGHUP, signal.SIGTERM)}
    entered = []

    def outside_the_main_thread():  # Python takes signal handlers only in the main thread
        with console.StopOnConsoleClose(lambda: None) as stop:
            entered.append(stop)
    with caplog.at_level(logging.WARNING):
        thread = threading.Thread(target=outside_the_main_thread, daemon=True)
        thread.start()
        thread.join(5)
    assert len(entered) == 1 and entered[0].done.is_set()
    assert "main thread" in caplog.text
    assert {signum: signal.getsignal(signum) for signum in before} == before


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no SIGHUP, and nothing sends it SIGTERM")
@pytest.mark.parametrize("name", ["SIGHUP", "SIGTERM"])
def test_a_signal_ignored_by_what_started_vial_stays_ignored(name):
    """ Vial doesn't take a signal ignored by what started it. SIGHUP: nohup, Vial runs on when its terminal is closed.
    SIGTERM: uvicorn takes it all the same while serving, and stops on it. """
    signum = getattr(signal, name)
    before = signal.signal(signum, signal.SIG_IGN)
    try:
        with console.StopOnConsoleClose(lambda: pytest.fail("stopped")):
            assert signal.getsignal(signum) is signal.SIG_IGN
        assert signal.getsignal(signum) is signal.SIG_IGN
    finally:
        signal.signal(signum, before or signal.SIG_DFL)


@pytest.mark.skipif(sys.platform == "win32", reason="nothing sends a Windows process SIGTERM")
def test_sigterm_stops_the_server_and_vial_cleans_up_although_uvicorn_raises_it_again():
    """ uvicorn takes SIGTERM (log-out, kill) while serving. Once stopped it restores the previous handler and raises
    SIGTERM again: with the default handler the process would end before serve() closes the keyboard """
    before = signal.getsignal(signal.SIGTERM)
    outside = []

    def recording(signum, frame):  # stands in for the default handler: a SIGTERM that gets past Vial fails the test
        outside.append(signum)    # instead of ending pytest
    signal.signal(signal.SIGTERM, recording)
    try:
        server = uvicorn.Server(uvicorn.Config(None))
        stops = []
        with console.StopOnConsoleClose(lambda: stops.append(True)):
            with server.capture_signals():  # what uvicorn.Server.serve() runs in
                signal.raise_signal(signal.SIGTERM)
                assert server.should_exit and stops == []  # uvicorn's own handler
            assert stops == [True]  # raised again: here, and the block goes on to its cleanup
        assert outside == []
        assert signal.getsignal(signal.SIGTERM) is recording
    finally:
        signal.signal(signal.SIGTERM, before or signal.SIG_DFL)
