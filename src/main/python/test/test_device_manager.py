import logging
import sys
import types

import pytest

import transport
from server.device import (DeviceIOError, DeviceManager, FakeBackend, HidBackend, KeyboardLocked, NotConnected,
                           Status, require_unlocked)
from simulator.corne import make_corne, encode


@pytest.fixture
def manager(monkeypatch):
    # failed sends retry with 0.5 s pauses; skip the waiting
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    return m


def test_connect_loads_keyboard(manager):
    assert manager.connected
    assert manager.title == "Simulated: Simulated Corne"
    assert manager.unlocked
    assert manager.run(lambda kb: kb.layers) == 4


def test_run_without_keyboard_raises():
    m = DeviceManager(FakeBackend(make_corne))
    with pytest.raises(NotConnected):
        m.run(lambda kb: None)


def test_unplug_and_replug_are_reported(manager):
    manager.backend.virtual.connected = False
    assert manager.check() == ["disconnected"]
    assert not manager.connected
    assert manager.check() == []
    manager.backend.virtual.connected = True
    assert manager.check() == ["connected"]
    assert manager.connected


def test_unplug_during_write_raises_not_connected(manager):
    manager.backend.virtual.connected = False
    with pytest.raises(NotConnected):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
    assert manager.check() == ["disconnected"]


def test_write_error_while_present_is_reraised(manager):
    def fail(kb):
        raise RuntimeError("bad reply")
    with pytest.raises(RuntimeError, match="bad reply"):
        manager.run(fail)
    assert manager.connected


def test_reload_rereads_device(manager):
    manager.backend.virtual.keymap[0][0][0] = 0x04
    manager.reload()
    assert manager.run(lambda kb: kb.layout[(0, 0, 0)]) == "KC_A"


def test_require_unlocked(manager):
    require_unlocked(manager.keyboard)
    manager.backend.virtual.unlocked = False
    with pytest.raises(KeyboardLocked):
        require_unlocked(manager.keyboard)


# ---------- dead handles ----------

def test_dead_handle_while_present_is_reopened_by_the_next_check(manager):
    """ A replug on the same port (same path) or a USB reset leaves the old handle dead while the keyboard is
    still listed """
    def dead(data):
        raise OSError("the handle is invalid")
    manager.device.write = dead
    with pytest.raises(RuntimeError):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
    assert manager.connected  # the request failed; the poll decides what to do with the keyboard
    assert manager.check() == ["disconnected", "connected"]
    manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
    assert manager.backend.virtual.keymap[0][0][0] == encode("KC_B")
    assert manager.check() == []


def test_closed_handle_is_a_device_error_not_a_bad_request(manager):
    manager.device.close()  # real hidapi and the simulator raise ValueError("not opened") from now on
    with pytest.raises(DeviceIOError):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
    assert manager.check() == ["disconnected", "connected"]
    assert manager.run(lambda kb: kb.get_unlock_status()) == 1


def test_working_handle_is_kept_after_a_failed_request(manager):
    def fail(kb):
        raise RuntimeError("bad reply")
    with pytest.raises(RuntimeError):
        manager.run(fail)
    device = manager.device
    assert manager.check() == []
    assert manager.device is device


def test_handle_that_recovers_is_kept(manager):
    real_write = manager.device.write
    failures = []

    def flaky(data):
        if not failures:
            failures.append(True)
            raise OSError("hiccup")
        return real_write(data)
    manager.device.write = flaky
    manager.run(lambda kb: kb.reload_layers())  # the protocol's retry gets through
    device = manager.device
    assert failures
    assert manager.check() == []
    assert manager.device is device


# ---------- failed loads ----------

def test_failed_reload_disconnects_instead_of_keeping_a_half_loaded_keyboard(manager):
    def broken():
        raise RuntimeError("transient bad reply")
    manager.keyboard.reload_keymap = broken
    with pytest.raises(RuntimeError, match="transient bad reply"):
        manager.reload()
    assert not manager.connected
    assert manager.error == "transient bad reply"
    with pytest.raises(NotConnected):
        manager.run(lambda kb: kb.layers)
    assert manager.check() == ["disconnected", "connected"]
    assert manager.error is None
    assert manager.run(lambda kb: kb.layers) == 4


class Clock:

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FailingBackend(FakeBackend):
    """ A keyboard that is listed but can never be loaded """

    def __init__(self):
        super().__init__(make_corne)
        self.opened = 0

    def open(self, candidate):
        self.opened += 1
        raise RuntimeError("unsupported keyboard")


def test_keyboard_that_fails_to_load_is_not_reopened_on_every_poll():
    clock = Clock()
    backend = FailingBackend()
    m = DeviceManager(backend, clock=clock)
    for _ in range(3):
        assert m.check() == []
    assert backend.opened == 1
    assert m.error == "unsupported keyboard"
    # retried later, less and less often
    clock.now += 2
    m.check()
    assert backend.opened == 2
    clock.now += 2
    m.check()
    assert backend.opened == 2
    clock.now += 2
    m.check()
    assert backend.opened == 3
    clock.now += 1000
    m.check()
    clock.now += 30
    m.check()
    assert backend.opened == 5  # at most every 30 s


def test_keyboard_that_failed_to_load_is_retried_after_a_replug():
    backend = FailingBackend()
    m = DeviceManager(backend, clock=Clock())
    m.check()
    backend.virtual.connected = False
    assert m.check() == []
    assert m.error is None  # nothing is plugged in: no error to show
    backend.virtual.connected = True
    m.check()
    assert backend.opened == 2


def test_explicit_connect_ignores_the_backoff():
    backend = FailingBackend()
    m = DeviceManager(backend, clock=Clock())
    assert not m.connect()
    assert not m.connect()
    assert backend.opened == 2


def test_failed_load_survives_close_failing():
    class BadClose(FakeBackend):
        def open(self, candidate):
            dev, title = super().open(candidate)

            def dead(data):
                raise OSError("dead")

            def broken_close():
                raise OSError("close failed")
            dev.write, dev.close = dead, broken_close
            return dev, title
    m = DeviceManager(BadClose(make_corne))
    assert not m.connect()
    assert m.error


# ---------- backend errors ----------

def test_check_survives_find_failing(caplog):
    class BrokenFind(FakeBackend):
        def find(self):
            raise OSError("hidapi exploded")
    m = DeviceManager(BrokenFind(make_corne))
    with caplog.at_level(logging.ERROR, logger="server.device"):
        assert m.check() == []
    assert "hidapi exploded" in caplog.text
    assert not m.connected


def test_check_treats_present_failing_as_unplugged(manager, caplog, monkeypatch):
    def broken(candidate):
        raise OSError("hidapi exploded")
    monkeypatch.setattr(manager.backend, "present", broken)
    monkeypatch.setattr(manager.backend, "find", lambda: [])
    with caplog.at_level(logging.ERROR, logger="server.device"):
        assert manager.check() == ["disconnected"]
    assert "hidapi exploded" in caplog.text


def test_run_keeps_the_original_error_when_present_fails(manager, monkeypatch):
    def broken(candidate):
        raise OSError("hidapi exploded")
    monkeypatch.setattr(manager.backend, "present", broken)

    def fail(kb):
        raise RuntimeError("bad reply")
    with pytest.raises(NotConnected) as info:
        manager.run(fail)
    assert str(info.value.__cause__) == "bad reply"
    assert not manager.connected


def test_status_is_a_consistent_snapshot(manager):
    assert manager.status() == Status(connected=True, title="Simulated: Simulated Corne", unlocked=True,
                                      error=None)
    manager.backend.virtual.connected = False
    manager.check()
    assert manager.status() == Status(connected=False, title=None, unlocked=False, error=None)


# ---------- real backend, against a stand-in for hidapi ----------

def test_hid_backend_present_only_lists_the_keyboards_ids(monkeypatch):
    calls = []

    class FakeHid:
        @staticmethod
        def enumerate(*ids):
            calls.append(ids)
            return [{"path": b"kbd"}]
    # a stand-in module: the real hidapi is never imported or asked for devices here
    monkeypatch.setitem(sys.modules, "hidproxy", types.SimpleNamespace(hid=FakeHid))
    desc = {"path": b"kbd", "vendor_id": 0x55D4, "product_id": 0x0461}
    assert HidBackend().present(desc)
    assert not HidBackend().present(dict(desc, path=b"other"))
    assert calls == [(0x55D4, 0x0461)] * 2
