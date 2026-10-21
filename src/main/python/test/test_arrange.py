""" Arranging the layers through the API, against the simulator: the preview, Apply, the unlock, a keyboard switch, a
write that fails partway with Finish and Put back, and a keyboard with encoders """
import copy
import json
import random
import re
import urllib.parse

import pytest
from fastapi.testclient import TestClient

import transport
from keycodes.keycodes import Keycode
from protocol.unlock_hook import set_unlock_handler
from server import model
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


def held_elsewhere(tmp_path, monkeypatch, steps, folder="elsewhere"):
    """ What a fresh simulated Corne holds after steps(client) """
    manager, _, app = make_app(tmp_path / folder, monkeypatch)
    (tmp_path / folder).mkdir(exist_ok=True)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        steps(client)
        return snapshot(manager.backend.virtual)


def arranged_elsewhere(tmp_path, monkeypatch, prepare, order, then=lambda c: None, folder="elsewhere"):
    """ What a fresh simulated Corne holds after prepare(client), an arrange that goes through, and then(client) """
    def steps(client):
        prepare(client)
        assert arrange(client, order).status_code == 200
        then(client)
    return held_elsewhere(tmp_path, monkeypatch, steps, folder)


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


def test_the_saved_default_layer_warning(setup):
    # PDF(n) saves layer n as the one the keyboard starts on, where Vial can't change it: the layers that move say so
    client, _, _ = setup
    assert preview(client)["savedDefault"] == []
    assert client.put("/api/keymap/1/0/0", json={"code": "PDF(2)"}).status_code == 200
    assert client.put("/api/macros", json={"items": [[{"type": "tap", "keys": ["PDF(3)"]}]] + [[]] * 15}) \
        .status_code == 200
    result = preview(client)
    assert result["savedDefault"] == [{"layer": 2, "to": 3}, {"layer": 3, "to": 1}]
    assert result["problems"] == []
    assert arrange(client).status_code == 200  # a warning: it doesn't stop the arrange


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


def test_macros_that_would_not_fit_are_a_problem_where_what(setup):
    """ The macros renumbered would need more than the macro memory: a problem as the others are, "where: what" """
    client, manager, _ = setup
    refer_to_layer_2(client)
    manager.run(lambda kb: setattr(kb, "macro_memory", 8))
    result = preview(client)
    assert result["writes"] == 0
    assert len(result["problems"]) == 1
    assert re.fullmatch(r"macros: they would need \d+ bytes but the keyboard has 8", result["problems"][0])


# ---------- the layout version ----------

def version(client):
    return client.get("/api/session").json()["layoutVersion"]


def test_the_layout_version_counts_what_moves_the_layers_or_replaces_the_layout(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    assert version(client) == 0 and preview(client)["layoutVersion"] == 0
    # edits leave it: an Undo still applies after them
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_Q"}).status_code == 200
    assert client.put("/api/names/layers/1", json={"name": "Nav"}).status_code == 200
    assert version(client) == 0
    response = arrange(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["layoutVersion"], body["kept"]) == (1, 0)
    assert len(body["layers"]) == 4 and "keyOverrides" in body  # the keyboard's model, as before
    assert version(client) == 1 and preview(client)["layoutVersion"] == 1
    # a layout file loaded, as is
    original = client.get("/api/layout-file").content
    assert client.post("/api/layout-file", content=original).status_code == 200
    assert version(client) == 2
    # a layout file loaded partway counts too
    changed = json.loads(original)
    changed["layout"][1][0] = ["KC_A"] * 6
    virtual.fail_writes(3)
    assert client.post("/api/layout-file", content=json.dumps(changed)).status_code == 502
    manager.check()
    assert version(client) == 3


def test_apply_expecting_another_version_is_refused(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    assert arrange(client).status_code == 200
    virtual.writes.clear()
    # an Undo shown before another tab's arrange: refused, with a code of its own among the 409s
    response = client.post("/api/layers/arrange", json={"order": reverse(ORDER), "expect": 0})
    assert response.status_code == 409
    assert response.json() == {"detail": "The layers changed since this was shown.", "code": "layoutChanged"}
    assert virtual.writes == []
    response = client.post("/api/layers/arrange", json={"order": reverse(ORDER), "expect": 1})
    assert response.status_code == 200, response.text
    assert response.json()["layoutVersion"] == 2
    # without expect, as before
    assert arrange(client).status_code == 200 and version(client) == 3
    for expect in (-1, True, "1", 1.5):
        assert client.post("/api/layers/arrange", json={"order": ORDER, "expect": expect}).status_code == 422


def test_a_stopped_arrange_finish_and_put_back_each_count(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    virtual.fail_writes(10)
    assert arrange(client).status_code == 502
    manager.check()
    assert version(client) == 1
    virtual.fail_writes(3)
    assert client.post("/api/layers/arrange/finish").status_code == 502
    manager.check()
    assert version(client) == 2
    response = client.post("/api/layers/arrange/finish")
    assert response.status_code == 200
    assert (response.json()["layoutVersion"], response.json()["kept"]) == (3, 0)
    virtual.fail_writes(10)
    assert arrange(client, reverse(ORDER)).status_code == 502
    manager.check()
    response = client.post("/api/layers/arrange/put-back")
    assert response.status_code == 200
    assert (response.json()["layoutVersion"], response.json()["kept"]) == (5, 0)
    # nothing is counted for what is refused before a write
    assert client.post("/api/layers/arrange/finish").status_code == 404
    assert arrange(client, [0, 1, 1, 2]).status_code == 422
    assert version(client) == 5


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
    assert client.get("/api/session").json()["arrange"] == {"order": ORDER, "done": 9, "total": total,
                                                            "namesOnly": False}
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


TD0 = {"tap": "KC_TAB", "doubleTap": "KC_CAPS", "tapHold": "KC_NO", "tappingTerm": 200}


def refer_to_layer_2(client):
    """ A tap dance and a macro the arrange renumbers; written after the keymap, so after a stop at write 10 """
    assert client.put("/api/tap-dance/0", json=dict(TD0, hold="MO(2)")).status_code == 200
    assert client.put("/api/macros", json={"items": [[{"type": "tap", "keys": ["MO(2)", "KC_A"]}]] + [[]] * 15}) \
        .status_code == 200


def edit_after_the_stop(client):
    """ A key, a tap dance and the macros changed to values neither the start nor the target has """
    assert client.put("/api/keymap/3/1/1", json={"code": "KC_F13"}).status_code == 200
    assert client.put("/api/tap-dance/0", json=dict(TD0, hold="MO(1)")).status_code == 200
    assert client.put("/api/macros", json={"items": [[{"type": "tap", "keys": ["KC_X"]}]] + [[]] * 15}) \
        .status_code == 200


KEPT = "3 changed since the stop were kept as they are"


@pytest.mark.parametrize("finish", [True, False])
def test_finish_and_put_back_keep_what_was_changed_since_the_stop(setup, tmp_path, monkeypatch, caplog, finish):
    client, manager, _ = setup
    refer_to_layer_2(client)
    if finish:
        expected = arranged_elsewhere(tmp_path, monkeypatch, refer_to_layer_2, ORDER, then=edit_after_the_stop)
    else:
        expected = held_elsewhere(tmp_path, monkeypatch, lambda c: (refer_to_layer_2(c), edit_after_the_stop(c)))
    virtual = manager.backend.virtual
    virtual.fail_writes(10)
    assert arrange(client).status_code == 502
    manager.check()
    edit_after_the_stop(client)
    with caplog.at_level("INFO", logger="server.arranger"):
        response = client.post("/api/layers/arrange/" + ("finish" if finish else "put-back"))
    assert response.status_code == 200, response.text
    assert response.json()["kept"] == 3
    assert snapshot(virtual) == expected
    assert manager.run(lambda kb: kb.layout[(3, 1, 1)]) == "KC_F13"
    assert KEPT in caplog.text
    assert client.get("/api/session").json()["arrange"] is None


def test_another_keyboard_with_the_same_uid_never_gets_the_stopped_arrange(tmp_path, monkeypatch):
    """ Keyboards built from one firmware share its UID: the arrange stopped on one is kept for that one only """
    manager, _, app = make_app(tmp_path, monkeypatch, second=make_corne)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        manager.backend.set_second_connected(True)
        manager.check()
        first, second = (e.info.id for e in manager.keyboard_list().entries)
        virtual, other = manager.backend.virtual, manager.backend.second
        assert manager.run(lambda kb: kb.keyboard_id) == other.uid == virtual.uid
        start, other_start = snapshot(virtual), snapshot(other)
        virtual.fail_writes(10)
        assert arrange(client).status_code == 502
        manager.check()
        assert client.post("/api/keyboards/select", json={"id": second}).status_code == 200
        assert client.get("/api/session").json()["arrange"] is None
        other.writes.clear()
        assert client.post("/api/layers/arrange/put-back").status_code == 404
        assert client.post("/api/layers/arrange/finish").status_code == 404
        assert other.writes == [] and snapshot(other) == other_start
        # it can be arranged meanwhile, as any other keyboard
        assert arrange(client).status_code == 200
        assert client.post("/api/keyboards/select", json={"id": first}).status_code == 200
        assert client.get("/api/session").json()["arrange"]["done"] == 9
        assert client.post("/api/layers/arrange/put-back").status_code == 200
        assert snapshot(virtual) == start


def other_keymap():
    """ A Corne like the sample, but for its layers 1 to 3, all KC_F24 """
    virtual = make_corne()
    for layer in virtual.keymap[1:]:
        for row in layer:
            row[:] = [encode("KC_F24")] * len(row)
    return virtual


def test_a_stopped_arrange_kept_under_another_keyboard_is_not_its_own(tmp_path, monkeypatch):
    """ Keyboards alike with no serial number of their own can swap ids after both are replugged (keyboard_infos): the
    arrange stopped on one is then kept under the id of the other. It is shown, finished or put back only on a keyboard
    where most keymap positions it changes hold the start's or the target's value. """
    manager, _, app = make_app(tmp_path, monkeypatch, second=other_keymap)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        manager.backend.set_second_connected(True)
        manager.check()
        first, second = (e.info.id for e in manager.keyboard_list().entries)
        other = manager.backend.second
        manager.backend.virtual.fail_writes(10)
        assert arrange(client).status_code == 502
        manager.check()
        # the ids swapped: what was kept for the first is now under the second's
        arrangements, uid = app.state.arrangements, manager.run(model.uid_of)
        arrangements.keep((uid, second), arrangements.get((uid, first)))
        arrangements.drop((uid, first))
        assert client.post("/api/keyboards/select", json={"id": second}).status_code == 200
        assert client.get("/api/session").json()["arrange"] is None
        other_start = snapshot(other)
        other.writes.clear()
        assert client.post("/api/layers/arrange/put-back").status_code == 404
        assert client.post("/api/layers/arrange/finish").status_code == 404
        assert other.writes == [] and snapshot(other) == other_start
        # it is arranged as any other keyboard
        assert arrange(client).status_code == 200
        # back under its own id, the first keyboard's is shown again
        arrangements.keep((uid, first), arrangements.get((uid, second)))
        assert client.post("/api/keyboards/select", json={"id": first}).status_code == 200
        assert client.get("/api/session").json()["arrange"]["done"] == 9


LONG = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ"


def macros_across_chunks(client):
    """ Macro 0 refers to layers 2 and 1 in different 28-byte chunks of the macro buffer, macro 1 to layer 2 after
    them: a stop between two chunks leaves macro 0 part renumbered """
    items = [[{"type": "tap", "keys": ["MO(2)"]}, {"type": "text", "text": LONG}, {"type": "tap", "keys": ["MO(1)"]}],
             [{"type": "tap", "keys": ["MO(2)"]}]] + [[]] * 14
    assert client.put("/api/macros", json={"items": items}).status_code == 200


def edit_macro_2(client):
    """ Macro 2 written anew, as the page saves the macros: the others as it shows them """
    items = client.get("/api/keyboard").json()["macros"]["items"]
    actions = [[{key: ([k["code"] for k in value] if key == "keys" else value) for key, value in action.items()
                 if value is not None} for action in item["actions"]] for item in items]
    actions[2] = [{"type": "tap", "keys": ["KC_X"]}]
    assert client.put("/api/macros", json={"items": actions}).status_code == 200


def stop_in_the_macros(client, manager):
    """ An arrange stopped at the macro buffer's second chunk: its first chunk holds the target's bytes, the rest the
    start's. Returns the macro buffer before. """
    start = manager.run(lambda kb: kb.macro)
    manager.backend.virtual.fail_writes(preview(client)["writes"] + 1)
    assert arrange(client).status_code == 502
    manager.check()
    assert client.get("/api/session").json()["arrange"] is not None
    return start


@pytest.mark.parametrize("finish", [True, False])
def test_a_macro_buffer_stopped_between_chunks_is_written_whole(setup, tmp_path, monkeypatch, finish):
    client, manager, _ = setup
    macros_across_chunks(client)
    target = arranged_elsewhere(tmp_path, monkeypatch, macros_across_chunks, ORDER)
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    held = stop_in_the_macros(client, manager)
    mixed = manager.run(lambda kb: kb.macro)
    assert mixed != held and len(mixed) == len(held)
    response = client.post("/api/layers/arrange/" + ("finish" if finish else "put-back"))
    assert response.status_code == 200, response.text
    assert snapshot(virtual) == (target if finish else start)


@pytest.mark.parametrize("finish", [True, False])
def test_a_macro_edited_after_a_stop_in_the_macros_is_kept_and_the_others_written(setup, tmp_path, monkeypatch,
                                                                                    caplog, finish):
    client, manager, _ = setup
    macros_across_chunks(client)
    if finish:
        expected = arranged_elsewhere(tmp_path, monkeypatch, macros_across_chunks, ORDER, then=edit_macro_2)
    else:
        expected = held_elsewhere(tmp_path, monkeypatch, lambda c: (macros_across_chunks(c), edit_macro_2(c)))
    stop_in_the_macros(client, manager)
    edit_macro_2(client)
    with caplog.at_level("INFO", logger="server.arranger"):
        response = client.post("/api/layers/arrange/" + ("finish" if finish else "put-back"))
    assert response.status_code == 200, response.text
    assert snapshot(manager.backend.virtual) == expected
    assert "1 changed since the stop were kept as they are" in caplog.text


def names_held_by_another_program(monkeypatch, names):
    """ names.move_layers fails, as when another program holds names.json; returns the real one """
    move_layers = names.move_layers

    def held(uid, order):
        raise PermissionError(13, "held by another program")
    monkeypatch.setattr(names, "move_layers", held)
    return move_layers


NAMES_NOT_SAVED = "The layers were arranged, but the layer names couldn't be saved: "


def test_names_not_saved_after_every_write_then_finish(setup, tmp_path, monkeypatch):
    """ Every write went through, then the names couldn't be saved: the arrange stays unfinished at its end; Finish
    writes nothing and saves the names only """
    client, manager, names = setup
    name_layers(client, {3: "Num"})
    target = arranged_elsewhere(tmp_path, monkeypatch, lambda c: None, ORDER)
    virtual = manager.backend.virtual
    total = preview(client)["writes"]
    move_layers = names_held_by_another_program(monkeypatch, names)
    response = arrange(client)
    assert response.status_code == 507
    assert response.json()["detail"].startswith(NAMES_NOT_SAVED)
    assert manager.connected and snapshot(virtual) == target
    # the layers are arranged: only the names are left to save
    assert client.get("/api/session").json()["arrange"] == {"order": ORDER, "done": total, "total": total,
                                                            "namesOnly": True}
    assert client.get("/api/names").json()["layers"] == {"3": "Num"}
    # Finish fails the same way while the file is held, and writes nothing to the keyboard
    virtual.writes.clear()
    response = client.post("/api/layers/arrange/finish")
    assert response.status_code == 507 and response.json()["detail"].startswith(NAMES_NOT_SAVED)
    assert virtual.writes == []
    assert client.get("/api/session").json()["arrange"] == {"order": ORDER, "done": 0, "total": 0,
                                                            "namesOnly": True}
    monkeypatch.setattr(names, "move_layers", move_layers)
    response = client.post("/api/layers/arrange/finish")
    assert response.status_code == 200, response.text
    assert virtual.writes == [] and snapshot(virtual) == target
    assert client.get("/api/names").json()["layers"] == {"1": "Num"}
    assert client.get("/api/session").json()["arrange"] is None


def test_names_not_saved_after_every_write_then_put_back(setup, monkeypatch):
    """ Put back writes the start back; the names, never moved, need no saving """
    client, manager, names = setup
    name_layers(client, {3: "Num"})
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    names_held_by_another_program(monkeypatch, names)
    assert arrange(client).status_code == 507
    response = client.post("/api/layers/arrange/put-back")
    assert response.status_code == 200, response.text
    assert snapshot(virtual) == start
    assert client.get("/api/names").json()["layers"] == {"3": "Num"}
    assert client.get("/api/session").json()["arrange"] is None


def test_names_only_while_the_keyboard_holds_the_new_order(setup, monkeypatch):
    """ After the names couldn't be saved, only the names are left while Finish would write nothing else: an edit since
    (kept by Finish) leaves it so; a layout file that puts the old order back doesn't. The session then says the stop
    as any other (its own counts), and Finish writes the new order again, then the names. """
    client, manager, names = setup
    name_layers(client, {3: "Num"})
    virtual = manager.backend.virtual
    backup = client.get("/api/layout-file").content
    start = snapshot(virtual)
    total = preview(client)["writes"]
    move_layers = names_held_by_another_program(monkeypatch, names)
    assert arrange(client).status_code == 507
    monkeypatch.setattr(names, "move_layers", move_layers)
    names_only = {"order": ORDER, "done": total, "total": total, "namesOnly": True}
    assert client.get("/api/session").json()["arrange"] == names_only
    # a key the arrange changed, edited to what neither order has there: Finish keeps it, and writes nothing else
    old = manager.run(lambda kb: kb.layout[(1, 1, 1)])
    assert client.put("/api/keymap/1/1/1", json={"code": "KC_F13"}).status_code == 200
    assert client.get("/api/session").json()["arrange"] == names_only
    assert client.put("/api/keymap/1/1/1", json={"code": old}).status_code == 200
    target = snapshot(virtual)
    # the layout file saved before the arrange, loaded: the keyboard holds the old order again
    assert client.post("/api/layout-file", content=backup).status_code == 200
    assert snapshot(virtual) == start
    assert client.get("/api/session").json()["arrange"] == dict(names_only, namesOnly=False)
    virtual.writes.clear()
    response = client.post("/api/layers/arrange/finish")
    assert response.status_code == 200, response.text
    assert len(virtual.writes) > 0 and snapshot(virtual) == target
    assert client.get("/api/names").json()["layers"] == {"1": "Num"}
    assert client.get("/api/session").json()["arrange"] is None


def test_the_fail_write_hook_is_fake_only_and_not_in_the_schema(setup):
    client, manager, _ = setup
    assert "/api/simulator/fail-write" not in client.get("/openapi.json").json()["paths"]
    assert client.put("/api/simulator/fail-write", json={"after": 2}).status_code == 200
    assert manager.backend.virtual.fail_write_in == 2
    assert client.put("/api/simulator/fail-write", json={"after": None}).status_code == 200
    assert manager.backend.virtual.fail_write_in is None
    for after in (True, "3", 2.0, 0):
        assert client.put("/api/simulator/fail-write", json={"after": after}).status_code == 422
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


def test_the_tri_layer_warning_with_three_layers(tmp_path, monkeypatch):
    # the firmware may hold a tri-layer key with fewer than 4 layers (Vial refuses to put one there): layer 3, which
    # it turns on, isn't there, which null says
    def tri_knob():
        virtual = knob()
        virtual.keymap[0][0][1] = encode("FN_MO13")
        return virtual
    _, _, app = make_app(tmp_path, monkeypatch, factory=tri_knob)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        assert preview(client, [0, 2, 1])["triLayer"] == [2, 1, None]
