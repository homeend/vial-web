""" Arranging the layers through the API, against the simulator: the preview, Apply, the unlock, a keyboard switch, a
write that fails partway with Finish and Put back, and a keyboard with encoders """
import copy
import random
import urllib.parse

import pytest
from fastapi.testclient import TestClient

import transport
from keycodes.keycodes import Keycode
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.layers import reverse
from server.names import NamesStore
from simulator.corne import encode, make_corne
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN
from test.test_api_validation import snapshot

ORDER = [0, 3, 1, 2]
""" the design's example: layer 3 to position 1 """


def make_app(tmp_path, monkeypatch, factory=make_corne, second=None):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(factory, second))
    manager.connect()
    names = NamesStore(str(tmp_path / "names.json"))
    return manager, names, create_app(manager, names, TOKEN, PORT, poll_interval=0)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """ (client, manager, names) """
    manager, names, app = make_app(tmp_path, monkeypatch)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        yield client, manager, names
    set_unlock_handler(None)


def preview(client, order=ORDER):
    response = client.post("/api/layers/arrange/preview", json={"order": order})
    assert response.status_code == 200, response.text
    return response.json()


def arrange(client, order=ORDER, **kwargs):
    return client.post("/api/layers/arrange", json={"order": order}, **kwargs)


def layer_codes(client):
    return [[k["code"] for k in layer["keys"]] for layer in client.get("/api/keyboard").json()["layers"]]


def name_layers(client, names):
    for index, name in names.items():
        assert client.put("/api/names/layers/{}".format(index), json={"name": name}).status_code == 200


def arranged_elsewhere(tmp_path, monkeypatch, prepare, order):
    """ What a fresh simulated Corne holds after prepare(client) and an arrange that goes through """
    manager, _, app = make_app(tmp_path / "elsewhere", monkeypatch)
    (tmp_path / "elsewhere").mkdir(exist_ok=True)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        prepare(client)
        assert arrange(client, order).status_code == 200
        return snapshot(manager.backend.virtual)


# ---------- the preview ----------

def test_the_preview_writes_nothing(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    before = snapshot(virtual)
    virtual.writes.clear()
    result = preview(client)
    assert virtual.writes == [] and snapshot(virtual) == before
    assert result["moves"] == [{"layer": 3, "to": 1}, {"layer": 1, "to": 2}, {"layer": 2, "to": 3}]
    # LT1(Space), LT2(B), LT2(S) and OSL(3) on the base layer; TO(0) on layer 3 stays as it is
    assert result["references"]["keymap"] == 4
    assert result["writes"] == result["keys"] > 0
    assert result["problems"] == [] and result["triLayer"] is None and not result["needsUnlock"]


def test_the_current_order_changes_nothing(setup):
    client, manager, _ = setup
    result = preview(client, [0, 1, 2, 3])
    assert (result["moves"], result["keys"], result["writes"]) == ([], 0, 0)
    virtual = manager.backend.virtual
    virtual.writes.clear()
    assert arrange(client, [0, 1, 2, 3]).status_code == 200
    assert virtual.writes == []


@pytest.mark.parametrize("order", [[0, 1, 1, 2], [0, 1, 2], [1, 0, 2, 3], [0, 1, 2, 3, 4], []])
def test_orders_that_are_not_the_layers_are_refused(setup, order):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    virtual.writes.clear()
    assert client.post("/api/layers/arrange/preview", json={"order": order}).status_code == 422
    assert arrange(client, order).status_code == 422
    assert virtual.writes == []


def test_the_tri_layer_warning(setup):
    client, _, _ = setup
    assert client.put("/api/keymap/0/3/3", json={"code": "FN_MO13"}).status_code == 200
    assert preview(client)["triLayer"] == [3, 1, 2]
    assert preview(client, [0, 1, 2, 3])["triLayer"] is None


# ---------- Apply ----------

def test_apply_writes_only_the_differences_and_moves_the_names(setup):
    client, manager, names = setup
    name_layers(client, {1: "Sym", 3: "Num"})
    virtual = manager.backend.virtual
    before = layer_codes(client)
    expected = preview(client)
    virtual.writes.clear()
    response = arrange(client)
    assert response.status_code == 200, response.text
    assert len(virtual.writes) == expected["writes"]
    # every write changed something
    assert all(w[0] == "keycode" for w in virtual.writes)
    layers = response.json()["layers"]
    assert [(layer["name"], layer["customName"]) for layer in layers] == [
        ("Base", False), ("Num", True), ("Sym", True), ("Layer 3", False)]
    after = [[k["code"] for k in layer["keys"]] for layer in layers]
    renumbered = {"LT1(KC_SPACE)": "LT2(KC_SPACE)", "LT2(KC_B)": "LT3(KC_B)", "LT2(KC_S)": "LT3(KC_S)", "OSL(3)": "OSL(1)"}
    assert after[0] == [renumbered.get(code, code) for code in before[0]]
    assert after[1:] == [before[3], before[1], before[2]]
    assert client.get("/api/names").json()["layers"] == {"1": "Num", "2": "Sym"}


def test_the_reverse_order_puts_everything_back(setup, tmp_path):
    client, manager, _ = setup
    name_layers(client, {2: "Nav"})
    assert client.put("/api/macros", json={"items": [[{"type": "tap", "keys": ["MO(2)", "KC_A"]}]] + [[]] * 15}) \
        .status_code == 200
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    named = client.get("/api/names").json()
    assert arrange(client).status_code == 200
    macro = client.get("/api/keyboard").json()["macros"]["items"][0]["actions"][0]["keys"]
    assert [k["code"] for k in macro] == ["MO(3)", "KC_A"]
    assert snapshot(virtual) != start
    assert arrange(client, reverse(ORDER)).status_code == 200
    assert snapshot(virtual) == start
    assert client.get("/api/names").json() == named


def test_random_orders_round_trip_on_the_keyboard(tmp_path, monkeypatch):
    rng = random.Random(4)
    manager, _, app = make_app(tmp_path, monkeypatch, factory=lambda: make_corne(layers=8))
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        layer_keys = ["MO({})", "TG({})", "TO({})", "OSL({})", "TT({})", "LT{}(KC_A)", "LM({}, MOD_LSFT)", "DF({})"]
        for _ in range(20):
            layer, row, col = rng.randrange(8), rng.randrange(4), rng.randrange(3, 6)
            code = rng.choice(layer_keys).format(rng.randrange(8))
            assert client.put("/api/keymap/{}/{}/{}".format(layer, row, col), json={"code": code}).status_code == 200
        virtual = manager.backend.virtual
        start = snapshot(virtual)
        for _ in range(5):
            order = [0] + rng.sample(range(1, 8), 7)
            assert arrange(client, order).status_code == 200
            assert arrange(client, reverse(order)).status_code == 200
            assert snapshot(virtual) == start, order


def test_a_keyboard_switch_in_between_is_refused(tmp_path, monkeypatch):
    manager, _, app = make_app(tmp_path, monkeypatch, second=make_corne)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        manager.backend.set_second_connected(True)
        manager.check()
        first, second = (e.info.id for e in manager.keyboard_list().entries)
        assert client.post("/api/keyboards/select", json={"id": second}).status_code == 200
        writes = len(manager.backend.second.writes)
        meant = {"x-vial-keyboard": urllib.parse.quote(first, safe="")}
        for path in ("/api/layers/arrange", "/api/layers/arrange/preview"):
            assert client.post(path, json={"order": ORDER}, headers=meant).status_code == 409
        assert len(manager.backend.second.writes) == writes


def test_unlock_comes_first_when_qk_boot_must_move(setup):
    client, manager, _ = setup
    assert client.put("/api/keymap/1/0/1", json={"code": "QK_BOOT"}).status_code == 200
    virtual = manager.backend.virtual
    virtual.unlocked = False
    assert preview(client)["needsUnlock"]
    before = snapshot(virtual)
    virtual.writes.clear()
    response = arrange(client)
    assert response.status_code == 423
    assert virtual.writes == [] and snapshot(virtual) == before
    virtual.unlocked = True
    assert arrange(client).status_code == 200
    assert manager.run(lambda kb: kb.layout[(2, 0, 1)]) == "QK_BOOT"


def test_problems_refuse_apply(tmp_path, monkeypatch):
    manager, _, app = make_app(tmp_path, monkeypatch, factory=lambda: make_corne(layers=20))
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        order = [0, 1, 3] + list(range(4, 20)) + [2]  # layer 2 to position 19: LT2(KC_B) can't hold it
        result = preview(client, order)
        assert result["problems"] and all("can't go to position 19" in p for p in result["problems"])
        virtual = manager.backend.virtual
        virtual.writes.clear()
        response = arrange(client, order)
        assert response.status_code == 409 and "can't go to position 19" in response.json()["detail"]
        assert virtual.writes == []


# ---------- a write that fails partway ----------

def test_a_failure_partway_then_finish(setup, tmp_path, monkeypatch):
    client, manager, _ = setup
    name_layers(client, {3: "Num"})
    target = arranged_elsewhere(tmp_path, monkeypatch, lambda c: None, ORDER)
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    total = preview(client)["writes"]
    virtual.fail_writes(10)
    response = arrange(client)
    assert response.status_code == 502
    assert snapshot(virtual) not in (start, target)
    # the handle stopped working: the hot-plug poll opens the keyboard again
    manager.check()
    assert client.get("/api/session").json()["arrange"] == {"order": ORDER, "done": 9, "total": total}
    # names don't move until it is finished; nothing else is arranged meanwhile
    assert client.get("/api/names").json()["layers"] == {"3": "Num"}
    assert arrange(client, [0, 2, 1, 3]).status_code == 409
    # Finish fails too, and is tried again
    virtual.fail_writes(3)
    assert client.post("/api/layers/arrange/finish").status_code == 502
    manager.check()
    left = client.get("/api/session").json()["arrange"]
    assert left["done"] == 2 and left["total"] == total - 9
    response = client.post("/api/layers/arrange/finish")
    assert response.status_code == 200, response.text
    assert snapshot(virtual) == target
    assert client.get("/api/session").json()["arrange"] is None
    assert client.get("/api/names").json()["layers"] == {"1": "Num"}
    assert client.post("/api/layers/arrange/finish").status_code == 404
    assert client.post("/api/layers/arrange/put-back").status_code == 404


def test_a_failure_partway_then_put_back(setup):
    client, manager, _ = setup
    name_layers(client, {3: "Num"})
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    virtual.fail_writes(20)
    assert arrange(client).status_code == 502
    manager.check()
    assert client.post("/api/layers/arrange/put-back").status_code == 200
    assert snapshot(virtual) == start
    assert client.get("/api/names").json()["layers"] == {"3": "Num"}
    assert client.get("/api/session").json()["arrange"] is None


def test_unplugged_partway_then_finished_after_a_replug(setup, tmp_path, monkeypatch):
    client, manager, _ = setup
    target = arranged_elsewhere(tmp_path, monkeypatch, lambda c: None, ORDER)
    virtual = manager.backend.virtual
    virtual.fail_writes(5, unplug=True)
    assert arrange(client).status_code == 503
    assert not manager.connected
    assert client.get("/api/session").json()["arrange"] is None  # no keyboard loaded to say it of
    assert client.post("/api/layers/arrange/finish").status_code == 503
    manager.backend.set_connected(True)
    manager.check()
    assert client.get("/api/session").json()["arrange"]["done"] == 4
    assert client.post("/api/layers/arrange/finish").status_code == 200
    assert snapshot(virtual) == target


def test_a_failure_at_the_first_write_can_be_put_back(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    virtual.fail_writes(1)
    assert arrange(client).status_code == 502
    manager.check()
    assert client.get("/api/session").json()["arrange"]["done"] == 0
    virtual.writes.clear()
    assert client.post("/api/layers/arrange/put-back").status_code == 200
    assert virtual.writes == [] and snapshot(virtual) == start


def test_the_fail_write_hook_is_fake_only_and_not_in_the_schema(setup):
    client, manager, _ = setup
    assert "/api/simulator/fail-write" not in client.get("/openapi.json").json()["paths"]
    assert client.put("/api/simulator/fail-write", json={"after": 2}).status_code == 200
    assert manager.backend.virtual.fail_write_in == 2
    assert client.put("/api/simulator/fail-write", json={"after": None}).status_code == 200
    assert manager.backend.virtual.fail_write_in is None


# ---------- encoders ----------

KNOB = {"name": "Knob", "matrix": {"rows": 1, "cols": 2},
        "layouts": {"keymap": [["0,0", "0,1", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


def knob():
    virtual = VirtualKeyboard(KNOB, layers=3, keymap={(0, 0, 0): encode("MO(2)"), (2, 0, 1): encode("KC_A")})
    virtual.encoders = {(0, 0, 0): encode("TG(1)"), (0, 0, 1): encode("KC_VOLU"), (1, 0, 0): encode("KC_B"),
                        (2, 0, 1): encode("TO(2)")}
    return virtual


def test_encoders_move_and_follow(tmp_path, monkeypatch):
    manager, _, app = make_app(tmp_path, monkeypatch, factory=knob)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        result = preview(client, [0, 2, 1])
        assert result["references"] == {"keymap": 1, "encoders": 2, "tapDance": 0, "combos": 0, "keyOverrides": 0,
                                        "altRepeatKeys": 0, "macros": 0}
        assert arrange(client, [0, 2, 1]).status_code == 200
        held = manager.run(lambda kb: dict(kb.encoder_layout))
        assert held[(0, 0, 0)] == "TG(2)" and held[(0, 0, 1)] == "KC_VOLU"
        assert held[(2, 0, 0)] == "KC_B" and held[(1, 0, 1)] == "TO(1)"
        assert manager.run(lambda kb: (kb.layout[(0, 0, 0)], kb.layout[(1, 0, 1)])) == ("MO(1)", "KC_A")
        virtual = manager.backend.virtual
        assert Keycode.serialize(virtual.encoders[(1, 0, 1)]) == "TO(1)"
        assert copy.deepcopy(virtual.keymap[1][0]) == [0, encode("KC_A")]
