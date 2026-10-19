""" .vil files: the download's name; and the QMK settings definitions, which the settings page is built from """
import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN, setup, client  # noqa: F401 (fixtures)

# 1 row x 2 columns, one encoder, and a layout option
OPTIONS = {"name": "Knob/Pad: \"mini\"", "matrix": {"rows": 1, "cols": 2},
           "layouts": {"labels": ["Split"],
                       "keymap": [["0,0", "0,1\n\n\n0,0", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


@pytest.fixture
def knob(tmp_path, monkeypatch):
    """ (client, simulated keyboard with an encoder and a layout option) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(lambda: VirtualKeyboard(OPTIONS, layers=2)))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        c.get("/?token=" + TOKEN, follow_redirects=False)
        yield c, manager.backend.virtual
    set_unlock_handler(None)


# ---------- downloading ----------

def test_the_download_is_named_after_the_keyboard(client):
    disposition = client.get("/api/layout-file").headers["content-disposition"]
    assert disposition == "attachment; filename=\"Simulated Corne.vil\"; filename*=UTF-8''Simulated%20Corne.vil"


def test_a_name_with_characters_files_cannot_have(knob):
    client, virtual = knob
    disposition = client.get("/api/layout-file").headers["content-disposition"]
    assert disposition == "attachment; filename=\"Knob_Pad_ _mini.vil\"; filename*=UTF-8''Knob_Pad_%20_mini.vil"


# ---------- QMK settings definitions ----------

def test_setting_definitions_are_typed(client):
    tabs = client.get("/api/qmk-settings/definitions").json()["tabs"]
    magic = next(t for t in tabs if t["name"] == "Magic")
    assert magic["fields"][0] == {"type": "boolean", "title": "Swap Caps Lock and Left Control", "qsid": 21,
                                  "bit": 0, "width": 4, "min": None, "max": None}
    tapping_term = next(f for t in tabs for f in t["fields"] if f["qsid"] == 7)
    assert (tapping_term["type"], tapping_term["min"], tapping_term["max"], tapping_term["width"]) == \
        ("integer", 0, 10000, 2)
