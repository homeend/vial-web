""" The Learning feature's store (server.learning) and its routes """
import json
import os

import pytest
from fastapi.testclient import TestClient

from server import learning_layout
from server.app import create_app
from server.device import DeviceManager, FakeBackend
from server.learning import LearningStore, LessonSetInvalid, NotFound
from server.names import NamesStore
from simulator.corne import make_corne
from test.test_learning_check import minimal_set, EXPORT as MINI_EXPORT
from test.test_learning_layout import model_of, EXAMPLES

UID = "5EEDC0DE00420042"
""" the simulated Corne's uid """
TOKEN = "test-token"
PORT = 8766
BASE = "http://127.0.0.1:{}".format(PORT)


def example(name):
    with open(os.path.join(EXAMPLES, name), encoding="utf-8") as inf:
        return json.load(inf)


@pytest.fixture
def store(tmp_path):
    return LearningStore(str(tmp_path / "learning"))


@pytest.fixture
def root(tmp_path):
    return tmp_path / "learning"


def attempt(chars=100, errors=2, seconds=60, at="2026-10-22T07:40:12Z"):
    return {"at": at, "chars": chars, "errors": errors, "seconds": seconds}


# ---------- the store: files ----------

def test_files_live_under_the_keyboard_uid(store, root):
    store.set_settings(UID, {"passAccuracy": 90, "targetWpm": 25, "pictureInWords": False})
    store.set_fingers(UID, {"keys": {"r0c5": {"finger": "middle", "reach": "up"}}, "home": ["r1c1"]})
    store.import_set(UID, minimal_set())
    store.record(UID, "mini", "01-n1", attempt())
    assert sorted(os.listdir(root / UID)) == ["fingers.json", "progress", "sets", "settings.json"]
    assert os.listdir(root / UID / "sets") == ["mini.json"] and os.listdir(root / UID / "progress") == ["mini.json"]
    assert store.settings("OTHER") == {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
    assert store.sets("OTHER") == [] and store.fingers("OTHER") is None


def test_writes_are_atomic_and_leave_no_temp_file(store, root, monkeypatch):
    store.set_settings(UID, {"passAccuracy": 90, "targetWpm": 25, "pictureInWords": False})
    path = root / UID / "settings.json"
    before = path.read_bytes()

    def broken(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(os, "replace", broken)
    with pytest.raises(OSError):
        store.set_settings(UID, {"passAccuracy": 99, "targetWpm": 25, "pictureInWords": False})
    assert path.read_bytes() == before
    assert sorted(os.listdir(root / UID)) == ["settings.json"]


def test_a_corrupt_file_is_moved_aside_on_write_and_ignored_on_read(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "settings.json").write_text("{not json", encoding="utf-8")
    (folder / "fingers.json").write_text("[1, 2", encoding="utf-8")
    assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
    assert store.fingers(UID) is None
    assert not (folder / "settings.json.corrupt").exists()
    store.set_settings(UID, {"passAccuracy": 90, "targetWpm": 25, "pictureInWords": True})
    assert (folder / "settings.json.corrupt").read_text(encoding="utf-8") == "{not json"
    assert store.settings(UID)["passAccuracy"] == 90
    store.set_fingers(UID, {"keys": {}, "home": []})
    assert (folder / "fingers.json.corrupt").exists()


def test_a_file_with_a_byte_order_mark_is_read(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "settings.json").write_bytes(b"\xef\xbb\xbf" + json.dumps({"targetWpm": 40}).encode("utf-8"))
    assert store.settings(UID)["targetWpm"] == 40


def test_bad_uids_and_ids_stay_inside_the_store(store):
    with pytest.raises(ValueError):
        store.settings("../x")
    with pytest.raises(NotFound):
        store.set(UID, "../../etc")
    with pytest.raises(NotFound):
        store.progress(UID, "a/b")
    with pytest.raises(NotFound):
        store.delete_set(UID, "")


# ---------- the store: fingers ----------

def test_fingers_round_trip_and_reset(store):
    assert store.fingers(UID) is None
    saved = store.set_fingers(UID, {"keys": {"r0c5": {"finger": "middle", "reach": "up"}}, "home": ["r1c1", "r1c1"]})
    assert saved == {"format": "vial-web-fingers/1", "keys": {"r0c5": {"finger": "middle", "reach": "up"}},
                     "home": ["r1c1"]}
    assert store.fingers(UID) == saved
    store.clear_fingers(UID)
    assert store.fingers(UID) is None
    store.clear_fingers(UID)  # nothing to clear: fine


@pytest.mark.parametrize("data", [
    "x", {"keys": {}}, {"keys": [], "home": []}, {"keys": {"r0c5": {"finger": "thumb"}}, "home": []},
    {"keys": {"r0c5": {"finger": "hand", "reach": "up"}}, "home": []},
    {"keys": {"r0c5": {"finger": "index", "reach": "far"}}, "home": []},
    {"keys": {"../x": {"finger": "index", "reach": "up"}}, "home": []}, {"keys": {}, "home": ["r1"]},
])
def test_fingers_are_validated(store, data):
    with pytest.raises(ValueError):
        store.set_fingers(UID, data)
    assert store.fingers(UID) is None


def test_a_saved_file_of_another_format_counts_as_nothing_saved(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "fingers.json").write_text(json.dumps({"format": "other/9", "keys": {}}), encoding="utf-8")
    assert store.fingers(UID) is None


def test_a_hand_edited_fingers_file_is_read_for_what_is_valid_in_it(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    path = folder / "fingers.json"
    path.write_text(json.dumps({
        "format": "vial-web-fingers/1",
        "keys": {"r0c5": {"finger": "middle", "reach": "up"}, "r0c6": {"finger": "hand", "reach": "far"},
                 "r0c7": {"finger": "index"}, "r0c8": "junk", "../x": {"finger": "index", "reach": "up"}},
        "home": ["r1c1", 5, "r1", "r1c1", ["r1c2"]]}), encoding="utf-8")
    assert store.fingers(UID) == {"format": "vial-web-fingers/1", "keys": {"r0c5": {"finger": "middle", "reach": "up"}},
                                  "home": ["r1c1"]}
    out = store.export(UID, model_of(make_corne), "en-us")
    assert next(k for k in out["keys"] if k["id"] == "r0c5")["finger"] == "middle"
    assert [k["id"] for k in out["keys"] if k["home"]] == ["r1c1"]
    # one part that isn't its type counts as empty; neither: nothing saved
    path.write_text(json.dumps({"format": "vial-web-fingers/1", "keys": 5, "home": []}), encoding="utf-8")
    assert store.fingers(UID) == {"format": "vial-web-fingers/1", "keys": {}, "home": []}
    path.write_text(json.dumps({"format": "vial-web-fingers/1", "keys": {}, "home": 5}), encoding="utf-8")
    assert store.fingers(UID) == {"format": "vial-web-fingers/1", "keys": {}, "home": []}
    path.write_text(json.dumps({"format": "vial-web-fingers/1", "keys": 5, "home": "r1c1"}), encoding="utf-8")
    assert store.fingers(UID) is None
    assert store.export(UID, model_of(make_corne), "en-us")["hash"] == example("corne-sim-layout-export.json")["hash"]


# ---------- the store: the export ----------

def test_export_is_saved_with_the_corrections(store, root):
    built = model_of(make_corne)
    store.set_fingers(UID, {"keys": {"r0c5": {"finger": "middle", "reach": "up"}}, "home": []})
    out = store.export(UID, built, "en-us")
    assert out["hash"] == example("corne-sim-layout-export.json")["hash"]
    key = next(k for k in out["keys"] if k["id"] == "r0c5")
    assert key["finger"] == "middle" and not any(k["home"] for k in out["keys"])
    saved = json.loads((root / UID / "layout-export.json").read_text(encoding="utf-8"))
    assert saved == out


# ---------- the store: lesson sets ----------

def test_import_list_get_and_delete(store, root):
    data = example("corne-sim-en.json")
    export = learning_layout.export(model_of(make_corne))
    entry = store.import_set(UID, data, export)
    assert entry == {"id": "corne-sim-en", "title": data["title"], "language": "en", "lessons": 2,
                     "layoutHash": export["hash"], "error": None, "warnings": []}
    assert store.sets(UID) == [{k: v for k, v in entry.items() if k != "warnings"}]
    assert store.set(UID, "corne-sim-en") == data
    assert json.loads((root / UID / "sets" / "corne-sim-en.json").read_text(encoding="utf-8")) == data
    store.record(UID, "corne-sim-en", data["lessons"][0]["exercises"][0]["id"], attempt())
    store.delete_set(UID, "corne-sim-en")
    assert store.sets(UID) == []
    with pytest.raises(NotFound):
        store.set(UID, "corne-sim-en")
    with pytest.raises(NotFound):
        store.delete_set(UID, "corne-sim-en")
    # the progress stays, for the set imported again
    assert store.progress(UID, "corne-sim-en")["exercises"] != {}


def test_import_refuses_a_bad_set_with_its_errors_and_warnings(store):
    data = minimal_set()
    data["lessons"][0]["exercises"][1]["lines"].append("ab cab")
    data["lessons"][0]["exercises"][2]["lines"] = ["abba baab"]
    with pytest.raises(LessonSetInvalid) as info:
        store.import_set(UID, data)
    assert info.value.errors == ["exercise 01-k1: uses characters not taught yet: 'c'"]
    assert info.value.warnings == ["exercise 01-w1: 9 characters; words should have 450-600"]
    assert "1 error" in str(info.value)
    assert store.sets(UID) == []


def test_import_keeps_warnings_and_checks_the_keys_against_the_export(store):
    data = minimal_set()
    data["lessons"][0]["exercises"][2]["lines"] = ["abba baab"]
    assert store.import_set(UID, data, MINI_EXPORT)["warnings"] == [
        "exercise 01-w1: 9 characters; words should have 450-600"]
    data["lessons"][0]["new"][0]["key"] = "r1c2"
    with pytest.raises(LessonSetInvalid) as info:
        store.import_set(UID, data, MINI_EXPORT)
    assert info.value.errors == ["lesson 01/new[0]: key r1c2 layer 0 tap types 'b', not 'a'"]


def test_files_dropped_in_by_hand_are_listed_with_their_error(store, root):
    folder = root / UID / "sets"
    folder.mkdir(parents=True)
    (folder / "broken.json").write_text("{", encoding="utf-8")
    bad = minimal_set()
    bad["id"], bad["title"] = "wrong", "Wrong id"
    (folder / "renamed.json").write_text(json.dumps(bad), encoding="utf-8")
    short = minimal_set()
    short["id"], short["lessons"] = "short", []
    (folder / "short.json").write_text(json.dumps(short), encoding="utf-8")
    (folder / "bad name.json").write_text(json.dumps(minimal_set()), encoding="utf-8")
    (folder / "notes.txt").write_text("not a set", encoding="utf-8")
    listed = {e["id"]: e for e in store.sets(UID)}
    assert set(listed) == {"broken", "renamed", "short", "bad name"}
    assert listed["broken"]["title"] == "broken" and listed["broken"]["error"].startswith("not a JSON file")
    assert listed["renamed"] == {"id": "renamed", "title": "Wrong id", "language": "en", "lessons": 1,
                                 "layoutHash": "sha256:0123456789abcdef", "error": "id: 'wrong' isn't the file name"}
    assert listed["short"]["error"] == "lessons: missing or empty" and listed["short"]["lessons"] == 0
    assert listed["bad name"]["error"] == "file name: letters, digits, - and _ only"
    with pytest.raises(ValueError):
        store.set(UID, "broken")
    with pytest.raises(ValueError):
        store.set(UID, "renamed")


def test_import_of_the_same_id_replaces_the_set_and_keeps_its_progress(store):
    store.import_set(UID, minimal_set())
    store.record(UID, "mini", "01-n1", attempt())
    again = minimal_set()
    again["title"] = "Mini, second edition"
    assert store.import_set(UID, again)["title"] == "Mini, second edition"
    assert [s["title"] for s in store.sets(UID)] == ["Mini, second edition"]
    assert store.set(UID, "mini") == again
    assert store.progress(UID, "mini")["exercises"]["01-n1"]["done"]


def test_set_ids_name_files_exactly(store, root):
    """ On a case-insensitive file system (Windows, macOS) MINI.json opens mini.json; the listing says mini """
    store.import_set(UID, minimal_set())
    store.record(UID, "mini", "01-n1", attempt())
    with pytest.raises(NotFound):
        store.set(UID, "MINI")
    with pytest.raises(NotFound):
        store.record(UID, "MINI", "01-n1", attempt())
    assert store.progress(UID, "MINI")["exercises"] == {}
    with pytest.raises(NotFound):
        store.delete_set(UID, "Mini")
    assert os.listdir(root / UID / "sets") == ["mini.json"]
    assert [s["id"] for s in store.sets(UID)] == ["mini"]
    assert store.set(UID, "mini")["id"] == "mini" and store.progress(UID, "mini")["exercises"]["01-n1"]["done"]


# ---------- the store: progress ----------

def test_progress_is_empty_until_an_attempt_is_recorded(store):
    store.import_set(UID, minimal_set())
    assert store.progress(UID, "mini") == {"format": "vial-web-progress/1", "lessonSet": "mini", "layoutHash": None,
                                           "exercises": {}}
    assert store.progress(UID, "never") == {"format": "vial-web-progress/1", "lessonSet": "never",
                                            "layoutHash": None, "exercises": {}}


def test_record_computes_accuracy_wpm_and_best(store):
    store.import_set(UID, minimal_set())
    first = store.record(UID, "mini", "01-n1", attempt(chars=228, errors=3, seconds=88))
    assert first == {"done": True,
                     "best": {"at": "2026-10-22T07:40:12Z", "chars": 228, "errors": 3, "accuracy": 98.7, "wpm": 31.1,
                              "seconds": 88},
                     "attempts": [{"at": "2026-10-22T07:40:12Z", "chars": 228, "errors": 3, "accuracy": 98.7,
                                   "wpm": 31.1, "seconds": 88}]}
    # the same accuracy and a higher speed: the new best; a lower accuracy at any speed: not
    second = store.record(UID, "mini", "01-n1", attempt(chars=228, errors=3, seconds=60, at="t2"))
    assert second["best"]["at"] == "t2" and second["best"]["wpm"] == 45.6
    third = store.record(UID, "mini", "01-n1", attempt(chars=100, errors=10, seconds=10, at="t3"))
    assert third["best"]["at"] == "t2" and len(third["attempts"]) == 3 and third["attempts"][-1]["wpm"] == 120.0
    progress = store.progress(UID, "mini")
    assert progress["layoutHash"] == "sha256:0123456789abcdef"
    assert progress["exercises"]["01-n1"] == third
    assert store.record(UID, "mini", "01-w1", attempt(chars=10, errors=0, seconds=7.5))["best"]["seconds"] == 7.5
    assert store.record(UID, "mini", "01-w1", attempt(chars=10, errors=0, seconds=4.0))["best"]["seconds"] == 4


def test_the_last_fifty_attempts_are_kept_and_the_best_outlives_them(store):
    store.import_set(UID, minimal_set())
    for i in range(55):
        entry = store.record(UID, "mini", "01-k1", attempt(chars=100, errors=i, seconds=60, at="t{}".format(i)))
    assert len(entry["attempts"]) == 50
    assert entry["attempts"][0]["at"] == "t5" and entry["attempts"][-1]["at"] == "t54"
    assert entry["best"]["at"] == "t0" and entry["best"]["accuracy"] == 100.0  # the perfect attempt, though gone
    assert store.progress(UID, "mini")["exercises"]["01-k1"] == entry
    better = store.record(UID, "mini", "01-k1", attempt(chars=100, errors=0, seconds=30, at="t55"))
    assert better["best"]["at"] == "t55" and better["attempts"][0]["at"] == "t6"


def test_the_files_best_is_kept_when_it_is_an_attempt_and_recomputed_when_it_is_not(store, root):
    store.import_set(UID, minimal_set())
    folder = root / UID / "progress"
    folder.mkdir(parents=True)
    best = {"at": "long ago", "chars": 100, "errors": 0, "accuracy": 100.0, "wpm": 40.0, "seconds": 30}
    worse = {"at": "t", "chars": 100, "errors": 10, "accuracy": 90.0, "wpm": 20.0, "seconds": 60}
    (folder / "mini.json").write_text(json.dumps({
        "format": "vial-web-progress/1", "lessonSet": "mini", "layoutHash": "sha256:0123456789abcdef",
        "exercises": {"01-n1": {"done": True, "best": best, "attempts": [worse]},
                      "01-k1": {"done": True, "best": "junk", "attempts": [worse]},
                      "01-w1": {"attempts": [worse]}}}), encoding="utf-8")
    progress = store.progress(UID, "mini")
    assert progress["exercises"]["01-n1"] == {"done": True, "best": best, "attempts": [worse]}
    assert progress["exercises"]["01-k1"] == {"done": True, "best": worse, "attempts": [worse]}
    assert progress["exercises"]["01-w1"] == {"done": True, "best": worse, "attempts": [worse]}
    recorded = store.record(UID, "mini", "01-n1", attempt(chars=100, errors=5, seconds=60, at="t2"))
    assert recorded["best"] == best and [a["at"] for a in recorded["attempts"]] == ["t", "t2"]
    # a best with no attempts left at all still makes the exercise done
    (folder / "mini.json").write_text(json.dumps({"exercises": {"01-n1": {"best": best, "attempts": "junk"}}}),
                                      encoding="utf-8")
    assert store.progress(UID, "mini")["exercises"]["01-n1"] == {"done": True, "best": best, "attempts": []}


def test_record_refuses_unknown_exercises_and_bad_numbers(store):
    store.import_set(UID, minimal_set())
    with pytest.raises(NotFound):
        store.record(UID, "mini", "99-x", attempt())
    with pytest.raises(NotFound):
        store.record(UID, "other", "01-n1", attempt())
    nan, inf = float("nan"), float("inf")
    for bad in (attempt(chars=0), attempt(errors=-1), attempt(errors=101), attempt(seconds=0),
                attempt(chars="100"), attempt(chars=True), {"chars": 1, "errors": 0, "seconds": 1},
                attempt(seconds=nan), attempt(chars=nan), attempt(errors=nan), attempt(seconds=inf),
                attempt(chars=inf), attempt(errors=-inf), attempt(chars=100.5), attempt(errors=0.5)):
        with pytest.raises(ValueError):
            store.record(UID, "mini", "01-n1", bad)
    assert store.progress(UID, "mini")["exercises"] == {}
    # whole floats are whole numbers
    entry = store.record(UID, "mini", "01-n1", attempt(chars=100.0, errors=2.0, seconds=60))
    assert entry["best"]["chars"] == 100 and isinstance(entry["best"]["chars"], int)
    assert entry["best"]["errors"] == 2 and isinstance(entry["best"]["errors"], int)


def test_record_drops_the_progress_of_exercises_the_set_no_longer_has(store):
    store.import_set(UID, minimal_set())
    store.record(UID, "mini", "01-n1", attempt())
    store.record(UID, "mini", "01-k1", attempt())
    smaller = minimal_set()
    del smaller["lessons"][0]["exercises"][1]  # 01-k1
    store.import_set(UID, smaller)
    assert set(store.progress(UID, "mini")["exercises"]) == {"01-n1", "01-k1"}  # reading changes nothing
    store.record(UID, "mini", "01-w1", attempt())
    assert set(store.progress(UID, "mini")["exercises"]) == {"01-n1", "01-w1"}


def test_a_hand_edited_progress_file_is_cleaned_up(store, root):
    store.import_set(UID, minimal_set())
    folder = root / UID / "progress"
    folder.mkdir(parents=True)
    good = {"at": "t", "chars": 100, "errors": 0, "accuracy": 100.0, "wpm": 20.0, "seconds": 60}
    (folder / "mini.json").write_text(json.dumps({
        "format": "vial-web-progress/1", "lessonSet": "mini", "layoutHash": 5,
        "exercises": {"01-n1": {"done": False, "best": None,
                                "attempts": [good, "junk", {"at": "x"}, {**good, "wpm": float("nan")},
                                             {**good, "accuracy": True}]},
                      "01-k1": "junk", "01-w1": {"attempts": "junk"}}}), encoding="utf-8")
    progress = store.progress(UID, "mini")
    assert progress["layoutHash"] is None
    assert progress["exercises"] == {"01-n1": {"done": True, "best": good, "attempts": [good]},
                                     "01-w1": {"done": False, "best": None, "attempts": []}}
    assert store.record(UID, "mini", "01-n1", attempt())["attempts"][0] == good


# ---------- the store: settings ----------

def test_settings_defaults_and_validation(store):
    assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
    saved = store.set_settings(UID, {"passAccuracy": 50, "targetWpm": 300, "pictureInWords": False})
    assert saved == {"passAccuracy": 50, "targetWpm": 300, "pictureInWords": False} == store.settings(UID)
    for bad in ({"passAccuracy": 49, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": 101, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": 95, "targetWpm": 0, "pictureInWords": True},
                {"passAccuracy": 95, "targetWpm": 301, "pictureInWords": True},
                {"passAccuracy": 95.5, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": True, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": "yes"},
                {"passAccuracy": 95, "targetWpm": 30}, "x"):
        with pytest.raises(ValueError):
            store.set_settings(UID, bad)
    assert store.settings(UID) == saved


def test_settings_file_with_wrong_values_falls_back_to_the_defaults_for_them(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "settings.json").write_text(json.dumps({"passAccuracy": 200, "targetWpm": 40, "extra": 1}),
                                          encoding="utf-8")
    assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 40, "pictureInWords": True}


# ---------- the routes ----------

@pytest.fixture
def client(tmp_path):
    """ A client with a session cookie, on an app with a learning store under tmp_path/learning """
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     learning=LearningStore(str(tmp_path / "learning")))
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client


def test_routes_refuse_without_a_store(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        assert client.get("/api/learning/fingers").status_code == 501
        assert client.get("/api/learning/settings").status_code == 501
        assert client.get("/api/learning/sets").status_code == 501


def test_fingers_round_trip_and_reset_over_the_api(client, root):
    proposal = client.get("/api/learning/fingers").json()
    assert proposal["proposal"] is True and proposal["format"] == "vial-web-fingers/1"
    assert proposal["keys"]["r1c4"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert sorted(proposal["home"]) == ["r1c1", "r1c2", "r1c3", "r1c4", "r3c4", "r5c1", "r5c2", "r5c3", "r5c4", "r7c4"]
    assert len(proposal["keys"]) == 42
    home = [k for k in proposal["home"] if k != "r1c4"] + ["r1c5"]
    response = client.put("/api/learning/fingers", json={"keys": {"r0c5": {"finger": "middle", "reach": "up"},
                                                                  "r9c9": {"finger": "ring", "reach": "up"}},
                                                         "home": home})
    assert response.status_code == 200, response.text
    fixed = response.json()
    assert fixed["proposal"] is False
    assert fixed["keys"]["r0c5"]["finger"] == "middle" and fixed["keys"]["r0c5"]["reach"] == "up"
    assert fixed["keys"]["r1c5"]["home"] and fixed["keys"]["r1c5"]["reach"] == "rest"
    assert not fixed["keys"]["r1c4"]["home"]
    assert sorted(fixed["home"]) == sorted(home) and "r9c9" not in fixed["keys"]
    assert client.get("/api/learning/fingers").json() == fixed
    assert (root / UID / "fingers.json").exists()
    assert client.put("/api/learning/fingers", json={"keys": {"r0c5": {"finger": "hand", "reach": "up"}},
                                                     "home": []}).status_code == 422
    assert client.put("/api/learning/fingers", json={"keys": {}, "home": [], "extra": 1}).status_code == 422
    assert client.get("/api/learning/fingers").json() == fixed
    reset = client.delete("/api/learning/fingers")
    assert reset.status_code == 200 and reset.json() == proposal
    assert not (root / UID / "fingers.json").exists()


def test_export_is_saved_and_its_hash_stable(client, root):
    first = client.get("/api/learning/export")
    assert first.status_code == 200, first.text
    export = first.json()
    assert export["format"] == "vial-web-layout-export/1" and export["language"] == "en-us"
    assert export["keyboard"] == {"name": "Simulated Corne", "uid": UID}
    assert export["hash"] == example("corne-sim-layout-export.json")["hash"]
    saved = json.loads((root / UID / "layout-export.json").read_text(encoding="utf-8"))
    assert saved == export
    second = client.get("/api/learning/export").json()
    assert second["hash"] == export["hash"] and second["keys"] == export["keys"]
    assert client.get("/api/learning/export?lang=klingon").status_code == 422
    assert len(client.get("/api/learning/export?lang=en-us").json()["layers"]) == 4


def test_import_list_get_and_delete_over_the_api(client, root):
    data = example("corne-sim-en.json")
    assert client.get("/api/learning/sets").json() == []
    response = client.post("/api/learning/sets", json=data)
    assert response.status_code == 201, response.text
    assert response.json() == {"id": "corne-sim-en", "title": data["title"], "language": "en", "lessons": 2,
                               "layoutHash": data["layout"]["hash"], "outOfDate": False, "error": None,
                               "warnings": []}
    listed = client.get("/api/learning/sets").json()
    assert listed == [{"id": "corne-sim-en", "title": data["title"], "language": "en", "lessons": 2,
                       "layoutHash": data["layout"]["hash"], "outOfDate": False, "error": None}]
    assert client.get("/api/learning/sets/corne-sim-en").json() == data
    assert (root / UID / "sets" / "corne-sim-en.json").exists()
    assert client.delete("/api/learning/sets/corne-sim-en").status_code == 204
    assert client.get("/api/learning/sets").json() == []
    assert client.get("/api/learning/sets/corne-sim-en").status_code == 404
    assert client.delete("/api/learning/sets/corne-sim-en").status_code == 404
    assert client.get("/api/learning/sets/a%2Fb").status_code == 404


def test_import_refuses_a_bad_file_with_the_checkers_errors(client):
    data = example("corne-sim-en.json")
    data["lessons"][0]["exercises"][0]["lines"].append("zq zq")
    data["lessons"][1]["new"][0]["key"] = "r9c9"
    response = client.post("/api/learning/sets", json=data)
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["errors"] == ["exercise 01-n1: uses characters not taught yet: 'q' 'z'",
                              "lesson 02/new[0]: key r9c9 is not in the layout export"]
    assert body["detail"].startswith("the lesson set has 2 errors")
    assert isinstance(body["warnings"], list)
    assert client.get("/api/learning/sets").json() == []
    # not a lesson set at all
    assert client.post("/api/learning/sets", json=[1, 2]).status_code == 422
    assert client.post("/api/learning/sets", content=b"{not json").status_code == 422
    assert client.post("/api/learning/sets", json={"format": "x"}).json()["errors"][0].startswith("format:")
    assert client.post("/api/learning/sets?lang=klingon", json=data).status_code == 422


def test_import_of_a_set_made_for_another_layout_is_out_of_date(client):
    data = example("corne-sim-en.json")
    data["layout"]["hash"] = "sha256:ffffffffffffffff"
    response = client.post("/api/learning/sets", json=data)
    assert response.status_code == 201, response.text
    assert response.json()["outOfDate"] is True
    assert response.json()["warnings"] == ["layout/hash: differs from the export's hash: the set was made from "
                                           "another layout"]
    assert client.get("/api/learning/sets").json()[0]["outOfDate"] is True


def test_a_file_dropped_in_by_hand_is_listed_with_its_error(client, root):
    folder = root / UID / "sets"
    folder.mkdir(parents=True)
    (folder / "broken.json").write_text("{", encoding="utf-8")
    listed = client.get("/api/learning/sets").json()
    assert len(listed) == 1 and listed[0]["id"] == "broken" and listed[0]["error"].startswith("not a JSON file")
    assert listed[0]["outOfDate"] is False and listed[0]["layoutHash"] is None
    assert client.get("/api/learning/sets/broken").status_code == 422


def test_progress_over_the_api(client):
    data = example("corne-sim-en.json")
    assert client.post("/api/learning/sets", json=data).status_code == 201
    empty = client.get("/api/learning/progress/corne-sim-en").json()
    assert empty == {"format": "vial-web-progress/1", "lessonSet": "corne-sim-en", "layoutHash": None, "exercises": {}}
    response = client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(chars=228, errors=3, seconds=88))
    assert response.status_code == 200, response.text
    entry = response.json()
    assert entry["done"] is True and entry["best"]["accuracy"] == 98.7 and entry["best"]["wpm"] == 31.1
    assert entry["attempts"] == [entry["best"]]
    better = client.put("/api/learning/progress/corne-sim-en/01-n1",
                        json=attempt(chars=228, errors=0, seconds=100, at="t2")).json()
    assert better["best"]["at"] == "t2" and better["best"]["accuracy"] == 100.0 and len(better["attempts"]) == 2
    progress = client.get("/api/learning/progress/corne-sim-en").json()
    assert progress["exercises"] == {"01-n1": better} and progress["layoutHash"] == data["layout"]["hash"]
    assert client.put("/api/learning/progress/corne-sim-en/99-x", json=attempt()).status_code == 404
    assert client.put("/api/learning/progress/other-set/01-n1", json=attempt()).status_code == 404
    assert client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(chars=0)).status_code == 422
    assert client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(errors=300)).status_code == 422
    assert client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(seconds=0)).status_code == 422
    assert client.put("/api/learning/progress/corne-sim-en/01-n1",
                      json={**attempt(), "accuracy": 50}).status_code == 422
    assert client.get("/api/learning/progress/corne-sim-en").json() == progress
    assert client.get("/api/learning/progress/never").json()["exercises"] == {}


def test_settings_over_the_api(client):
    assert client.get("/api/learning/settings").json() == {"passAccuracy": 95, "targetWpm": 30,
                                                           "pictureInWords": True}
    response = client.put("/api/learning/settings", json={"passAccuracy": 90, "targetWpm": 40,
                                                          "pictureInWords": False})
    assert response.status_code == 200, response.text
    assert response.json() == {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": False}
    assert client.get("/api/learning/settings").json() == response.json()
    for bad in ({"passAccuracy": 49, "targetWpm": 40, "pictureInWords": False},
                {"passAccuracy": 90, "targetWpm": 301, "pictureInWords": False},
                {"passAccuracy": 90.5, "targetWpm": 40, "pictureInWords": False},
                {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": "no"},
                {"passAccuracy": 90, "targetWpm": 40},
                {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": False, "more": 1}):
        assert client.put("/api/learning/settings", json=bad).status_code == 422, bad
    assert client.get("/api/learning/settings").json() == response.json()


def test_learning_routes_need_a_keyboard(client):
    client.put("/api/simulator/connection", json={"connected": False})
    client.app.state.manager.check()  # the hot-plug poll (off in tests) notices
    assert client.get("/api/learning/fingers").status_code == 503
    assert client.get("/api/learning/sets").status_code == 503
    assert client.get("/api/learning/settings").status_code == 503
    assert client.post("/api/learning/sets", json=example("corne-sim-en.json")).status_code == 503


def test_a_learning_write_meant_for_another_keyboard_is_refused_and_writes_nothing(client, root):
    other = {"x-vial-keyboard": "some-other-keyboard"}
    fingers = {"keys": {}, "home": []}
    reply = client.put("/api/learning/fingers", json=fingers, headers=other)
    assert reply.status_code == 409, reply.text
    settings = {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": False}
    assert client.put("/api/learning/settings", json=settings, headers=other).status_code == 409
    assert client.post("/api/learning/sets", json=example("corne-sim-en.json"), headers=other).status_code == 409
    assert not root.exists() or not any(root.rglob("*"))
    assert client.get("/api/learning/fingers").json()["proposal"] is True


def test_an_oversized_lesson_set_is_refused(client, root):
    from server import app as app_module
    big = b" " * (app_module.MAX_LESSON_SET + 1)
    assert client.post("/api/learning/sets", content=big).status_code == 413
    assert client.post("/api/learning/sets", content=iter([big[:1000], big[1000:]])).status_code == 413
    assert client.get("/api/learning/sets").json() == []


def test_importing_the_same_id_again_replaces_the_file_even_a_broken_one(client, root):
    data = example("corne-sim-en.json")
    path = root / UID / "sets" / "corne-sim-en.json"
    assert client.post("/api/learning/sets", json=data).status_code == 201
    again = {**data, "title": "A new title"}
    assert client.post("/api/learning/sets", json=again).status_code == 201
    assert [s["title"] for s in client.get("/api/learning/sets").json()] == ["A new title"]
    path.write_text("{garbage", encoding="utf-8")
    assert client.get("/api/learning/sets").json()[0]["error"]
    assert client.post("/api/learning/sets", json=data).status_code == 201
    assert json.loads(path.read_text(encoding="utf-8")) == data
    assert (path.parent / "corne-sim-en.json.corrupt").read_text(encoding="utf-8") == "{garbage"
    listed = client.get("/api/learning/sets").json()
    assert [(s["title"], s["error"]) for s in listed] == [(data["title"], None)]


def test_a_set_goes_out_of_date_when_the_keymap_changes_and_back(client):
    assert client.post("/api/learning/sets", json=example("corne-sim-en.json")).status_code == 201
    assert client.get("/api/learning/sets").json()[0]["outOfDate"] is False
    kb = client.get("/api/keyboard").json()
    index = next(i for i, k in enumerate(kb["layers"][0]["keys"]) if k["tap"] == "S")  # whatever it is wrapped in
    row, col, original = kb["keys"][index]["row"], kb["keys"][index]["col"], kb["layers"][0]["keys"][index]["code"]
    assert client.put("/api/keymap/0/{}/{}".format(row, col), json={"code": "KC_X"}).status_code == 200
    assert client.get("/api/learning/sets").json()[0]["outOfDate"] is True
    assert client.put("/api/keymap/0/{}/{}".format(row, col), json={"code": original}).status_code == 200
    assert client.get("/api/learning/sets").json()[0]["outOfDate"] is False
