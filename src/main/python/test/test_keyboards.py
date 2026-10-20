""" Several Vial keyboards plugged in at once: the list, the choice of the one to use, and what follows a change """
import json
import sys
import time
import urllib.parse

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server import device
from server.app import create_app
from server.device import DeviceManager, FakeBackend, UnknownKeyboard, keyboard_infos, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from simulator.virtual_keyboard import VirtualKeyboard

TOKEN = "test-token"
PORT = 8765
BASE = "http://127.0.0.1:{}".format(PORT)
ORIGIN = {"origin": BASE}
EVENTS = "ws://127.0.0.1:{}/api/events".format(PORT)

PAD = {"name": "Simulated Pad", "matrix": {"rows": 1, "cols": 2},
       "layouts": {"keymap": [["0,0", "0,1"]]}}


def make_pad():
    return VirtualKeyboard(PAD, uid=0x1234)


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    # failed sends retry with 0.5 s pauses; skip the waiting
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)


def two_keyboards(second=make_pad):
    """ A manager with the simulated Corne open, and a second simulated keyboard plugged in """
    manager = DeviceManager(FakeBackend(make_corne, second))
    assert manager.connect()
    manager.backend.set_second_connected(True)
    assert manager.check() == []
    return manager


def ids(manager):
    return [entry.info.id for entry in manager.keyboard_list().entries]


def second_id(manager):
    return ids(manager)[1]


# ---------- what tells keyboards apart ----------

def hid_desc(path, serial="vial:f64c2b3c", vid=0x55D4, pid=0x0461, product="W-CORNE", manufacturer="Wcorne"):
    return {"path": path, "vendor_id": vid, "product_id": pid, "serial_number": serial, "product_string": product,
            "manufacturer_string": manufacturer}


def test_the_magic_is_hid_discoverys():
    from server import hid_discovery
    assert device.VIAL_SERIAL_MAGIC == hid_discovery.VIAL_SERIAL_NUMBER_MAGIC


def test_a_serial_number_of_its_own_identifies_a_keyboard_not_its_path():
    before = keyboard_infos([hid_desc(b"usb-1", "vial:f64c2b3c:A1B2")])[0]
    after = keyboard_infos([hid_desc(b"usb-7", "vial:f64c2b3c:A1B2")])[0]
    assert before.id == after.id
    assert before.serial == "A1B2"
    assert (before.name, before.vendor_id, before.product_id) == ("W-CORNE", 0x55D4, 0x0461)
    assert keyboard_infos([hid_desc(b"usb-1", "vial:f64c2b3c:C3D4")])[0].id != before.id


def test_the_vial_magic_alone_is_no_serial_number():
    """ Most Vial firmware's serial number is the magic every Vial keyboard has: the IDs and the name tell instead """
    info = keyboard_infos([hid_desc(b"usb-1")])[0]
    assert info.serial is None
    assert info.id == keyboard_infos([hid_desc(b"usb-2")])[0].id
    assert info.id != keyboard_infos([hid_desc(b"usb-1", product="Lily58")])[0].id
    assert info.id != keyboard_infos([hid_desc(b"usb-1", pid=0x0462)])[0].id


def test_identical_keyboards_found_together_are_numbered_in_the_order_of_their_paths():
    a, b = keyboard_infos([hid_desc(b"usb-2"), hid_desc(b"usb-1")])
    assert a.id != b.id
    assert (a.id[-2:], b.id[-2:]) == ("#2", "#1")
    assert keyboard_infos([hid_desc(b"usb-1")])[0].id == b.id


def test_an_identical_keyboard_keeps_its_number_while_it_stays_plugged_in():
    """ Its path is listed again: whatever comes and goes beside it, and however the paths sort ("hidraw10" before
    "hidraw3") """
    first, second = keyboard_infos([hid_desc("/dev/hidraw3"), hid_desc("/dev/hidraw10")])
    assert (first.id[-2:], second.id[-2:]) == ("#2", "#1")  # as strings, hidraw10 comes first
    # the first one unplugged: the other keeps its number, it doesn't take the one that went
    (left,) = keyboard_infos([hid_desc("/dev/hidraw10")], [first, second])
    assert left.id == second.id
    # one plugged in at a new path takes the lowest number free, wherever its path sorts
    back, kept = keyboard_infos([hid_desc("/dev/hidraw2"), hid_desc("/dev/hidraw10")], [left])
    assert (back.id, kept.id) == (first.id, second.id)
    # the other way round: the one numbered 2 stays 2, and the one coming back takes 1 again
    (stays,) = keyboard_infos([hid_desc("/dev/hidraw3")], [first, second])
    assert stays.id == first.id
    stays, again = keyboard_infos([hid_desc("/dev/hidraw3"), hid_desc("/dev/hidraw1")], [stays])
    assert (stays.id, again.id) == (first.id, second.id)


def test_a_path_that_now_has_another_keyboard_is_numbered_afresh():
    (before,) = keyboard_infos([hid_desc(b"usb-1", product="Lily58")])
    (after,) = keyboard_infos([hid_desc(b"usb-1")], [before])
    assert after.id == keyboard_infos([hid_desc(b"usb-1")])[0].id


def test_a_keyboard_without_a_product_name_is_named_by_its_title():
    assert keyboard_infos([hid_desc(b"usb-1", product="")])[0].name == "Wcorne"
    assert keyboard_infos([hid_desc(b"usb-1", product="", manufacturer="")])[0].name == "Vial keyboard"
    assert keyboard_infos([{"path": b"x", "vendor_id": 1, "product_id": 2, "serial_number": None}])[0].name == \
        "Vial keyboard"


def test_a_keyboard_keeps_its_usb_manufacturer_and_device_path():
    """ As Qt's About keyboard shows them: hidapi's path is bytes (text on Linux and macOS, a Windows device path) """
    info = keyboard_infos([hid_desc(b"\\\\?\\HID#VID_55D4&PID_0461&MI_01#8&1f2&0&0000#{4d1e55b2}")])[0]
    assert (info.manufacturer, info.path) == ("Wcorne", "\\\\?\\HID#VID_55D4&PID_0461&MI_01#8&1f2&0&0000#{4d1e55b2}")
    assert keyboard_infos([hid_desc("/dev/hidraw3")])[0].path == "/dev/hidraw3"
    assert keyboard_infos([hid_desc(b"usb-\xff")])[0].path == "usb-�"  # not text: shown as best it can be
    bare = keyboard_infos([{"path": b"x", "vendor_id": 1, "product_id": 2, "serial_number": None}])[0]
    assert (bare.manufacturer, bare.path) == ("", "x")


def test_simulated_keyboards_have_serial_numbers_of_their_own():
    manager = two_keyboards()
    first, second = manager.keyboard_list().entries
    assert (first.info.name, second.info.name) == ("Simulated Corne", "Simulated Pad")
    assert first.info.serial and second.info.serial and first.info.serial != second.info.serial


# ---------- the list ----------

def test_the_list_follows_keyboards_plugged_in_while_one_is_open():
    manager = DeviceManager(FakeBackend(make_corne, make_pad))
    assert manager.connect()
    changes = manager.changes
    manager.backend.set_second_connected(True)
    # no plug event: the open keyboard is the same
    assert manager.check() == []
    assert manager.changes > changes
    keyboards = manager.keyboard_list()
    assert [(e.info.name, e.plugged) for e in keyboards.entries] == [("Simulated Corne", True), ("Simulated Pad", True)]
    assert keyboards.open == ids(manager)[0] and keyboards.chosen is None
    changes = manager.changes
    assert manager.check() == []
    assert manager.changes == changes  # nothing changed
    manager.backend.set_second_connected(False)
    assert manager.check() == []
    assert manager.changes > changes
    assert len(manager.keyboard_list().entries) == 1


def test_listing_happens_outside_the_device_lock():
    """ Listing can take seconds on some systems: requests to the open keyboard go on meanwhile """
    manager = two_keyboards()
    held = []
    find = manager.backend.find

    def watching():
        held.append(manager.lock._is_owned())
        return find()
    manager.backend.find = watching
    manager.check()
    assert held == [False]


def test_a_failed_listing_while_a_keyboard_is_open_keeps_it_and_the_list(caplog):
    manager = two_keyboards()
    before = ids(manager)

    def broken():
        raise OSError("hidapi exploded")
    manager.backend.find = broken
    assert manager.check() == []
    assert manager.connected and ids(manager) == before
    assert manager.error is None
    assert "hidapi exploded" in caplog.text


# ---------- choosing ----------

def test_with_nothing_chosen_the_first_keyboard_found_is_opened():
    manager = two_keyboards()
    assert manager.title == "Simulated: Simulated Corne"
    assert manager.keyboard_list().chosen is None


def test_choosing_another_keyboard_closes_the_open_one_and_opens_it():
    manager = two_keyboards()
    corne = manager.backend.virtual
    target = second_id(manager)
    assert manager.select(target) is True
    assert manager.take_events() == ["connected"]
    assert manager.title == "Simulated: Simulated Pad"
    assert manager.run(lambda kb: (kb.rows, kb.cols)) == (1, 2)
    keyboards = manager.keyboard_list()
    assert keyboards.chosen == target and keyboards.open == target
    # the Corne is closed: nothing more is sent to it
    writes = len(corne.writes)
    manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
    assert len(corne.writes) == writes


def test_choosing_the_open_keyboard_only_remembers_the_choice():
    manager = two_keyboards()
    first = ids(manager)[0]
    device_before = manager.device
    assert manager.select(first) is False
    assert manager.take_events() == []
    assert manager.device is device_before
    assert manager.keyboard_list().chosen == first


def test_an_unknown_keyboard_cant_be_chosen():
    manager = two_keyboards()
    with pytest.raises(UnknownKeyboard):
        manager.select("nope")
    assert manager.keyboard_list().chosen is None
    assert manager.title == "Simulated: Simulated Corne"


def test_only_the_chosen_keyboard_is_ever_opened():
    """ Never open a keyboard nobody chose: the first one found stays closed while the chosen one is away """
    opened = []

    class Counting(FakeBackend):
        def open(self, candidate):
            opened.append(candidate["path"])
            return super().open(candidate)
    manager = DeviceManager(Counting(make_corne, make_pad))
    manager.connect()
    manager.backend.set_second_connected(True)
    manager.check()
    manager.select(second_id(manager))
    opened.clear()
    manager.backend.set_second_connected(False)
    for _ in range(3):
        manager.check()
    assert opened == []
    manager.backend.set_second_connected(True)
    manager.check()
    assert opened == ["simulated:2"]


def test_the_chosen_keyboard_unplugged_is_waited_for_not_replaced():
    manager = two_keyboards()
    target = second_id(manager)
    manager.select(target)
    manager.take_events()
    manager.backend.set_second_connected(False)
    assert manager.check() == ["disconnected"]
    assert manager.check() == []
    assert not manager.connected
    assert manager.error is None
    keyboards = manager.keyboard_list()
    # still listed, as unplugged, so that the choice shows
    assert [(e.info.id, e.plugged) for e in keyboards.entries] == [(ids(manager)[0], True), (target, False)]
    assert keyboards.chosen == target and keyboards.open is None
    manager.backend.set_second_connected(True)
    assert manager.check() == ["connected"]
    assert manager.title == "Simulated: Simulated Pad"


def test_another_keyboard_chosen_while_the_chosen_one_is_unplugged_becomes_the_choice():
    manager = two_keyboards()
    first, target = ids(manager)
    manager.select(target)
    manager.backend.set_second_connected(False)
    manager.check()
    manager.take_events()
    assert manager.select(first) is True
    assert manager.take_events() == ["connected"]
    manager.backend.set_second_connected(True)
    assert manager.check() == []
    assert manager.title == "Simulated: Simulated Corne"
    assert manager.keyboard_list().chosen == first


def test_the_choice_is_kept_by_identity_across_a_replug_of_both():
    manager = two_keyboards()
    target = second_id(manager)
    manager.select(target)
    manager.backend.set_connected(False)
    manager.backend.set_second_connected(False)
    manager.check()
    manager.backend.set_connected(True)
    manager.check()
    assert not manager.connected  # the Corne came back first: it isn't the choice
    manager.backend.set_second_connected(True)
    manager.check()
    assert manager.title == "Simulated: Simulated Pad"


def test_with_nothing_chosen_unplugging_the_open_keyboard_opens_another_as_before():
    manager = two_keyboards()
    manager.backend.set_connected(False)
    assert manager.check() == ["disconnected", "connected"]
    assert manager.title == "Simulated: Simulated Pad"


def test_choosing_another_keyboard_ends_an_unlock_of_the_one_closed():
    def locked():
        vk = make_corne()
        vk.unlocked = False
        vk.unlock_keys = [(0, 0)]
        return vk
    manager = DeviceManager(FakeBackend(locked, make_pad))
    manager.connect()
    manager.backend.set_second_connected(True)
    manager.check()
    manager.start_unlock()
    assert manager.unlock_state().state == "unlocking"
    manager.take_events()
    manager.select(second_id(manager))
    assert manager.take_events() == ["connected"]
    assert manager.unlock_state().state == "unlocked"  # the pad's own state
    assert manager.poll_unlock().state == "unlocked"  # nothing is followed any more


def test_a_chosen_keyboard_that_cant_be_read_says_why_and_the_other_is_closed():
    manager = two_keyboards()
    manager.backend.set_second_connected(False)
    manager.check()
    manager.backend.set_second_connected(True, unreadable=True)
    manager.check()
    manager.take_events()
    assert manager.select(second_id(manager)) is False
    assert manager.take_events() == ["disconnected"]
    assert not manager.connected
    assert manager.error.startswith("its firmware speaks a protocol this Vial doesn't know")
    assert manager.error_kind == "read"


# ---------- identical keyboards (no serial number of their own) ----------

class Identical(FakeBackend):
    """ Two simulated Cornes with the Vial magic alone for a serial number, as most Vial firmware has """
    @staticmethod
    def describe(number, virtual):
        return dict(FakeBackend.describe(number, virtual), serial_number=device.VIAL_SERIAL_MAGIC)


def two_identical():
    manager = DeviceManager(Identical(make_corne, make_corne))
    assert manager.connect()
    manager.backend.set_second_connected(True)
    assert manager.check() == []
    first, second = ids(manager)
    assert first != second
    assert [e.info.key for e in manager.keyboard_list().entries] == ["simulated:1", "simulated:2"]
    return manager, first, second


def test_the_chosen_one_of_identical_keyboards_unplugged_is_waited_for_not_replaced_by_the_other():
    """ The other one must not take the id of the one that went, and be opened as the one chosen """
    manager, first, second = two_identical()
    manager.select(first)
    manager.take_events()
    manager.backend.set_connected(False)
    assert manager.check() == ["disconnected"]
    assert not manager.connected
    keyboards = manager.keyboard_list()
    assert [(e.info.id, e.plugged) for e in keyboards.entries] == [(first, False), (second, True)]
    assert keyboards.chosen == first and keyboards.open is None
    manager.backend.set_connected(True)
    assert manager.check() == ["connected"]
    assert manager.candidate["path"] == "simulated:1"
    assert manager.keyboard_list().open == first


def test_the_chosen_one_of_identical_keyboards_stays_open_and_listed_once_when_the_other_is_unplugged():
    manager, first, second = two_identical()
    assert manager.select(second) is True
    manager.take_events()
    manager.backend.set_connected(False)
    assert manager.check() == []
    keyboards = manager.keyboard_list()
    assert [(e.info.id, e.plugged) for e in keyboards.entries] == [(second, True)]
    assert keyboards.open == second and manager.candidate["path"] == "simulated:2"
    # the other one back takes its number again; the one open is the same
    manager.backend.set_connected(True)
    assert manager.check() == []
    keyboards = manager.keyboard_list()
    assert [(e.info.id, e.plugged) for e in keyboards.entries] == [(first, True), (second, True)]
    assert keyboards.open == second and manager.candidate["path"] == "simulated:2"


def test_the_list_is_the_same_whatever_order_the_keyboards_are_found_in():
    """ hidapi promises no order: a listing in another order is no change, and the list shows them by id """
    manager = two_keyboards()
    before, changes = ids(manager), manager.changes
    find = manager.backend.find
    manager.backend.find = lambda: list(reversed(find()))
    assert manager.check() == []
    assert manager.changes == changes
    assert ids(manager) == before


# ---------- the error, and changes the UI is told about ----------

def test_an_error_appearing_or_clearing_while_nothing_is_loaded_is_a_change():
    """ The empty page's error must not go stale: no plug event comes when a keyboard can't be read, or when one that
    couldn't is unplugged """
    def unreadable():
        vk = make_corne()
        vk.vial_protocol = 99
        return vk
    manager = DeviceManager(FakeBackend(unreadable))
    changes = manager.changes
    assert manager.check() == []
    assert manager.error and manager.error_kind == "read"
    assert manager.changes > changes
    changes = manager.changes
    manager.backend.set_connected(False)
    assert manager.check() == []
    assert manager.error is None and manager.error_kind is None
    assert manager.changes > changes


def test_a_listing_that_fails_says_so():
    class BrokenFind(FakeBackend):
        def find(self):
            raise OSError("hidapi exploded")
    manager = DeviceManager(BrokenFind(make_corne))
    changes = manager.changes
    assert manager.check() == []
    assert manager.error == "could not list keyboards: hidapi exploded"
    assert manager.error_kind == "list"
    assert manager.changes > changes


def test_choosing_is_a_change():
    manager = two_keyboards()
    changes = manager.changes
    manager.select(ids(manager)[0])
    assert manager.changes > changes


# ---------- API ----------

@pytest.fixture
def setup(tmp_path):
    """ (client with a session cookie, manager, app): the Corne open and a second simulated keyboard plugged in """
    set_unlock_handler(require_unlocked)
    manager = two_keyboards()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager, app
    set_unlock_handler(None)


def test_the_list_route(setup):
    client, manager, app = setup
    corne, pad = ids(manager)
    listed = client.get("/api/keyboards").json()
    assert listed["chosen"] is None
    assert [(k["id"], k["name"], k["open"], k["plugged"]) for k in listed["keyboards"]] == [
        (corne, "Simulated Corne", True, True), (pad, "Simulated Pad", False, True)]
    first = listed["keyboards"][0]
    assert set(first) == {"id", "name", "manufacturer", "vendorId", "productId", "serial", "path", "open", "plugged"}
    assert first["serial"] == manager.keyboard_list().entries[0].info.serial
    # the USB facts the Keyboard page's About card shows, as the simulator gives them
    assert (first["manufacturer"], first["vendorId"], first["productId"], first["path"]) == (
        "Simulated", FakeBackend.VENDOR_ID, FakeBackend.PRODUCT_ID, "simulated:1")


def test_choosing_through_the_api_tells_every_tab(setup):
    client, manager, app = setup
    pad = second_id(manager)
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        reply = client.post("/api/keyboards/select", json={"id": pad})
        assert reply.status_code == 200
        assert reply.json()["chosen"] == pad
        assert [k["open"] for k in reply.json()["keyboards"]] == [False, True]
        assert ws.receive_json() == {"type": "connected"}
        assert ws.receive_json() == {"type": "keyboards"}
    session = client.get("/api/session").json()
    assert (session["device"], session["keyboard"]) == ("Simulated: Simulated Pad", pad)
    assert client.get("/api/keyboard").json()["name"] == "Simulated Pad"


def test_choosing_an_unknown_keyboard_is_404(setup):
    client, manager, app = setup
    assert client.post("/api/keyboards/select", json={"id": "nope"}).status_code == 404
    assert client.post("/api/keyboards/select", json={"id": 3}).status_code == 422
    assert client.post("/api/keyboards/select", json={}).status_code == 422


def test_the_keyboard_routes_need_the_session_and_this_origin(tmp_path):
    manager = two_keyboards()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        pad = second_id(manager)
        assert client.get("/api/keyboards").status_code == 401
        assert client.post("/api/keyboards/select", json={"id": pad}).status_code == 401
        client.get("/?token=" + TOKEN)
        assert client.post("/api/keyboards/select", json={"id": pad},
                           headers={"origin": "http://evil.example"}).status_code == 403
        assert client.get("/api/keyboards", headers={"host": "evil.example"}).status_code == 403
    assert manager.title == "Simulated: Simulated Corne"


def test_the_session_says_which_keyboard_is_open_the_error_kind_and_the_platform(setup):
    client, manager, app = setup
    session = client.get("/api/session").json()
    assert session["keyboard"] == ids(manager)[0]
    assert session["errorKind"] is None
    assert session["platform"] == sys.platform


def wait_for(ws, wanted, timeout=3.0):
    """ The events up to the first of type `wanted` """
    seen = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        event = ws.receive_json()
        seen.append(event["type"])
        if event["type"] == wanted:
            return seen
    raise AssertionError("no {} event: {}".format(wanted, seen))


def test_the_poll_tells_when_a_keyboard_is_plugged_in_or_the_error_changes(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne, make_pad))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0.01)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
            assert ws.receive_json() == {"type": "connected"}
            assert client.put("/api/simulator/second-keyboard", json={"connected": True}).json() == \
                {"connected": True}
            # a keyboard plugged in is no plug of the open one: only the list changed
            assert wait_for(ws, "keyboards") == ["keyboards"]
            assert len(client.get("/api/keyboards").json()["keyboards"]) == 2
            pad = second_id(manager)
            client.put("/api/simulator/second-keyboard", json={"connected": False})
            wait_for(ws, "keyboards")
            client.put("/api/simulator/second-keyboard", json={"connected": True, "unreadable": True})
            wait_for(ws, "keyboards")
            client.post("/api/keyboards/select", json={"id": pad})
            assert "disconnected" in wait_for(ws, "keyboards")
            session = client.get("/api/session").json()
            assert session["status"] == "disconnected" and session["errorKind"] == "read"
            assert session["error"].startswith("its firmware speaks a protocol")
            # unplugged, it no longer has an error: the tabs are told, though nothing was loaded
            client.put("/api/simulator/second-keyboard", json={"connected": False})
            assert wait_for(ws, "keyboards") == ["keyboards"]
            assert client.get("/api/session").json()["error"] is None


def test_choosing_another_keyboard_stops_the_matrix_tester(setup):
    client, manager, app = setup
    watcher = app.state.matrix
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        ws.send_json({"type": "matrix", "watch": True})
        assert ws.receive_json()["type"] == "matrix"
        assert watcher.watchers
        client.post("/api/keyboards/select", json={"id": second_id(manager)})
        assert not watcher.watchers
        assert watcher.last is None


def test_the_second_keyboard_hook_is_fake_only_and_not_in_the_schema(setup, tmp_path):
    client, manager, app = setup
    assert "/api/simulator/second-keyboard" not in client.get("/openapi.json").json()["paths"]

    class NoRealKeyboard:
        fake = False

        def find(self):
            return []
    real = create_app(DeviceManager(NoRealKeyboard()), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
                      poll_interval=0)
    with TestClient(real, base_url=BASE) as other:
        other.get("/?token=" + TOKEN)
        assert other.put("/api/simulator/second-keyboard", json={"connected": True}).status_code in (404, 405)
        assert other.get("/api/keyboards").json() == {"keyboards": [], "chosen": None}


# ---------- a change meant for the keyboard closed ----------

def meant(keyboard_id):
    """ The header a page sends with each change: the keyboard it shows (percent-encoded, as encodeURIComponent) """
    return {"x-vial-keyboard": urllib.parse.quote(keyboard_id, safe="")}


def test_a_change_meant_for_another_keyboard_is_refused_and_not_sent(setup):
    client, manager, app = setup
    corne, pad = ids(manager)
    virtual = manager.backend.virtual
    writes = len(virtual.writes)
    reply = client.put("/api/keymap/0/0/0", json={"code": "KC_B"}, headers=meant(pad))
    assert reply.status_code == 409
    assert reply.json()["detail"] == "The keyboard changed (another one was opened): this change was not sent."
    assert len(virtual.writes) == writes
    assert manager.connected and manager.title == "Simulated: Simulated Corne"


def test_a_change_meant_for_the_keyboard_open_or_for_none_goes_through(setup):
    client, manager, app = setup
    corne = ids(manager)[0]
    assert "%23" in meant(corne)["x-vial-keyboard"]  # its "#" is percent-encoded, and decoded by the server
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_B"}, headers=meant(corne)).status_code == 200
    # without the header (curl, older pages): as before
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_C"}).status_code == 200
    assert manager.run(lambda kb: kb.layout[(0, 0, 0)]) == "KC_C"
    # reads are never refused
    assert client.get("/api/keyboard", headers=meant("nope")).status_code == 200


def test_a_change_sent_from_a_tab_that_still_shows_the_keyboard_closed_never_reaches_the_one_opened(setup):
    """ Another tab switched keyboards: what this tab sends next is for the keyboard it shows, which was closed """
    client, manager, app = setup
    corne, pad = ids(manager)
    assert client.post("/api/keyboards/select", json={"id": pad}).status_code == 200
    second = manager.backend.second
    writes = len(second.writes)
    for request in (lambda: client.put("/api/keymap/0/0/0", json={"code": "KC_B"}, headers=meant(corne)),
                    lambda: client.put("/api/macros", json={"items": []}, headers=meant(corne)),
                    lambda: client.post("/api/reload", headers=meant(corne)),
                    lambda: client.post("/api/unlock/start", headers=meant(corne)),
                    lambda: client.put("/api/names/layers/0", json={"name": "X"}, headers=meant(corne))):
        assert request().status_code == 409
    assert len(second.writes) == writes
    assert manager.connected and manager.keyboard_list().open == pad  # refused, the keyboard stays open
    assert "X" not in json.dumps(client.get("/api/names").json())


def test_the_keyboard_meant_is_checked_under_the_device_lock():
    """ A switch can't come between the check and the change: both are made holding the lock """
    manager = two_keyboards()
    corne, pad = ids(manager)
    held = []
    check = manager._check_meant_for

    def watching():
        held.append(manager.lock._is_owned())
        check()
    manager._check_meant_for = watching
    token = device.meant_for.set(corne)
    try:
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
        manager.select(pad)
        with pytest.raises(device.KeyboardChanged):
            manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_C"))
        with pytest.raises(device.KeyboardChanged):
            manager.read(lambda kb: kb.rows)
    finally:
        device.meant_for.reset(token)
    assert held == [True, True, True]
    assert manager.run(lambda kb: kb.layout[(0, 0, 0)]) != "KC_C"


def test_the_event_type_is_in_the_schema(setup):
    client, manager, app = setup
    event = client.get("/openapi.json").json()["components"]["schemas"]["Event"]
    assert "keyboards" in event["properties"]["type"]["enum"]


def test_vial_web_simulates_a_second_keyboard_from_its_definition(tmp_path):
    import vial_web
    path = tmp_path / "pad.json"
    path.write_text(json.dumps(PAD), encoding="utf-8")
    backend = vial_web.make_backend(vial_web.parse_args(["--fake", "--second-definition", str(path)]))
    assert backend.second_factory().definition["name"] == "Simulated Pad"
    # by default, a second keyboard like the first
    backend = vial_web.make_backend(vial_web.parse_args(["--fake"]))
    assert backend.second_factory().definition["name"] == "Simulated Corne"
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--second-definition", str(path)])
