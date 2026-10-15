import pytest

import transport
from server.device import DeviceManager, FakeBackend, NotConnected, KeyboardLocked, require_unlocked
from simulator.corne import make_corne


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
