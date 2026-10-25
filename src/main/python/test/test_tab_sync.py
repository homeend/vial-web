""" Two tabs of one Vial: every write is told to every tab ("changed", with the writing tab's id), and a macro save
carries the macros version it was edited from (refused when they changed since) """
import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import changed_what, create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN

TAB = "x-vial-tab"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client
    set_unlock_handler(None)


def macros_of(client):
    return client.get("/api/keyboard").json()["macros"]


def blank(client):
    return [[] for _ in range(macros_of(client)["count"])]


def text(words):
    return [{"type": "text", "text": words}]


# ---------- what counts as a change ----------

def test_changed_what_names_the_writing_routes_only():
    assert changed_what("/api/keymap/0/1/2") == "keymap"
    assert changed_what("/api/encoders/0/0/0") == "encoders"
    assert changed_what("/api/layout-options") == "layout-options"
    assert changed_what("/api/tap-dance/3") == "tap-dance"
    assert changed_what("/api/combos/0") == "combos"
    assert changed_what("/api/key-overrides/1") == "key-overrides"
    assert changed_what("/api/alt-repeat/0") == "alt-repeat"
    assert changed_what("/api/macros") == "macros"
    assert changed_what("/api/qmk-settings/7") == "qmk-settings"
    assert changed_what("/api/qmk-settings/reset") == "qmk-settings"
    assert changed_what("/api/lighting") == "lighting" and changed_what("/api/lighting/save") == "lighting"
    assert changed_what("/api/names/layers/0") == "names"
    for path in ("/api/macros/parse", "/api/keycodes/parse", "/api/layout-file", "/api/reload", "/api/layers/arrange",
                 "/api/learning/sets", "/api/unlock/start", "/api/shutdown", "/api/keyboard", "/", "/api", "/keymap/0"):
        assert changed_what(path) is None, path


# ---------- the "changed" event ----------

def test_a_write_is_told_to_every_tab_with_the_writing_tab(client):
    with client.websocket_connect(EVENTS, headers=ORIGIN) as other, client.websocket_connect(EVENTS, headers=ORIGIN) as same:
        assert other.receive_json() == {"type": "connected"} and same.receive_json() == {"type": "connected"}
        assert client.put("/api/keymap/0/0/1", json={"code": "KC_Q"}, headers={TAB: "tab-a"}).status_code == 200
        event = {"type": "changed", "what": "keymap", "tab": "tab-a"}
        assert other.receive_json() == event and same.receive_json() == event  # the writing tab filters its own
        # without the header (the API used by hand): no tab named
        assert client.put("/api/names/layers/0", json={"name": "Base"}).status_code == 200
        assert other.receive_json() == {"type": "changed", "what": "names", "tab": None}


def test_a_refused_write_a_read_and_a_parse_are_not_told(client):
    with client.websocket_connect(EVENTS, headers=ORIGIN) as tab:
        assert tab.receive_json() == {"type": "connected"}
        assert client.put("/api/keymap/0/0/1", json={"code": "KC_NOPE_NOT_A_CODE"}).status_code == 422
        assert client.get("/api/keyboard").status_code == 200
        assert client.post("/api/macros/parse", json={"text": '[["text", "hi"]]'}).status_code == 200
        assert client.post("/api/keycodes/parse", json={"expression": "KC_A"}).status_code == 200
        # the next thing the tab hears is this write, not any of the above
        assert client.put("/api/keymap/0/0/1", json={"code": "KC_W"}, headers={TAB: "t"}).status_code == 200
        assert tab.receive_json() == {"type": "changed", "what": "keymap", "tab": "t"}


def test_a_macro_save_is_told(client):
    with client.websocket_connect(EVENTS, headers=ORIGIN) as tab:
        assert tab.receive_json() == {"type": "connected"}
        items = blank(client)
        items[0] = text("hello")
        assert client.put("/api/macros", json={"items": items}, headers={TAB: "m"}).status_code == 200
        assert tab.receive_json() == {"type": "changed", "what": "macros", "tab": "m"}


# ---------- the macros version ----------

def test_the_macros_version_counts_writes_and_guards_a_stale_save(client):
    assert macros_of(client)["version"] == 0
    first = blank(client)
    first[0] = text("one")
    saved = client.put("/api/macros", json={"items": first, "expect": 0})
    assert saved.status_code == 200 and saved.json()["version"] == 1
    assert macros_of(client)["version"] == 1
    # a save of the same thing writes nothing and counts nothing
    again = client.put("/api/macros", json={"items": first, "expect": 1})
    assert again.status_code == 200 and again.json()["version"] == 1
    # a tab that still has version 0 is refused, and nothing is written
    stale = blank(client)
    stale[1] = text("stale")
    refused = client.put("/api/macros", json={"items": stale, "expect": 0})
    assert refused.status_code == 409
    assert refused.json()["code"] == "macrosChanged" and "changed since" in refused.json()["detail"]
    now = macros_of(client)
    assert now["version"] == 1 and now["items"][1]["actions"] == [] and now["items"][0]["actions"][0]["text"] == "one"
    # without expect: whatever the version
    assert client.put("/api/macros", json={"items": stale}).status_code == 200
    assert macros_of(client)["version"] == 2


def test_a_reload_counts_as_a_macro_write(client):
    assert macros_of(client)["version"] == 0
    assert client.post("/api/reload").status_code == 200
    assert macros_of(client)["version"] == 1
    refused = client.put("/api/macros", json={"items": blank(client), "expect": 0})
    assert refused.status_code == 409 and refused.json()["code"] == "macrosChanged"
