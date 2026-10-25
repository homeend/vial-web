""" The lesson generator's files served for download (server.learning_generator and its routes) """
import io
import json
import os
import sys
import zipfile

import pytest
from fastapi.testclient import TestClient

import resources
from server import learning_generator
from server.app import create_app
from server.device import DeviceManager, FakeBackend
from server.learning import LearningStore
from server.names import NamesStore
from simulator.corne import make_corne
from test.test_learning import BASE, PORT, TOKEN

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
NAMES = ["PROMPT.md", "GENERATE.md", "lesson-rules.md", "lesson-format.md", "lesson-set.schema.json",
         "corne-sim-en.json", "corne-sim-layout-export.json", "ansi-60-en.json", "course-method.md", "SKILL.md"]
PACKED = NAMES[:6]


def make_client(tmp_path, with_store=True):
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    store = LearningStore(str(tmp_path / "learning")) if with_store else None
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0, learning=store)
    client = TestClient(app, base_url=BASE)
    client.__enter__()
    assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
    return client


@pytest.fixture
def client(tmp_path):
    client = make_client(tmp_path)
    yield client
    client.__exit__(None, None, None)


# ---------- the files ----------

def test_every_listed_file_is_in_the_repository_and_names_are_unique():
    assert [f.name for f in learning_generator.FILES] == NAMES
    assert len(learning_generator.BY_NAME) == len(learning_generator.FILES)
    for file in learning_generator.FILES:
        path = learning_generator.path_of(file)
        assert os.path.isfile(path), path
        assert os.path.normcase(path).startswith(os.path.normcase(REPO))
        assert learning_generator.size(file) == len(learning_generator.read(file)) > 0
    assert [f.name for f in learning_generator.PACKED] == PACKED
    assert learning_generator.path_of(learning_generator.BY_NAME["SKILL.md"]) == os.path.join(
        REPO, ".claude", "skills", "generate-lessons", "SKILL.md")
    assert learning_generator.path_of(learning_generator.BY_NAME["ansi-60-en.json"]) == os.path.join(
        REPO, "docs", "learning", "examples", "ansi-60-en.json")


def test_the_documents_are_bundled_in_the_executable():
    assert resources.LEARNING_DOCS in resources.BUNDLED and resources.GENERATE_SKILL in resources.BUNDLED


def test_frozen_the_files_are_read_from_the_unpacked_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert learning_generator.path_of(learning_generator.BY_NAME["GENERATE.md"]) == os.path.join(
        str(tmp_path), "docs", "learning", "GENERATE.md")
    assert learning_generator.path_of(learning_generator.BY_NAME["corne-sim-en.json"]) == os.path.join(
        str(tmp_path), "docs", "learning", "examples", "corne-sim-en.json")
    assert learning_generator.path_of(learning_generator.BY_NAME["SKILL.md"]) == os.path.join(
        str(tmp_path), "skills", "generate-lessons", "SKILL.md")


def test_the_pack_holds_the_packed_files_and_the_export():
    export = {"format": "vial-web-layout-export/1", "keyboard": {"name": "Kbd", "uid": "1"}, "hash": "sha256:00",
              "keys": [{"id": "r0c0", "chars": "ż"}]}
    with zipfile.ZipFile(io.BytesIO(learning_generator.pack(export))) as zf:
        assert zf.namelist() == PACKED + ["layout-export.json"]
        for name in PACKED:
            assert zf.read(name) == learning_generator.read(learning_generator.BY_NAME[name])
        written = zf.read("layout-export.json").decode("utf-8")
    assert json.loads(written) == export
    assert written.startswith('{\n "format"') and written.endswith("\n") and "ż" in written


def test_pack_name_follows_the_web_ui_file_names():
    assert learning_generator.pack_name("Simulated Corne") == "Simulated Corne-lesson-generator.zip"
    assert learning_generator.safe_file_name('a<b>:"c/d\\e|f?g*h') == "a_b_c_d_e_f_g_h"
    assert learning_generator.safe_file_name(" ._ name_. ") == "name"
    assert learning_generator.safe_file_name("...") == "keyboard" and learning_generator.safe_file_name("") == "keyboard"
    assert learning_generator.safe_file_name("x" * 120) == "x" * 100
    assert learning_generator.safe_file_name("a\x01\x1fb") == "a_b"


def test_attachment_header_names_the_file_and_encodes_a_non_ascii_name():
    assert learning_generator.attachment("GENERATE.md") == 'attachment; filename="GENERATE.md"'
    assert learning_generator.attachment('a"b.zip') == 'attachment; filename="a_b.zip"'
    assert learning_generator.attachment("Żółw-lesson-generator.zip") == \
        "attachment; filename=\"___w-lesson-generator.zip\"; filename*=UTF-8''%C5%BB%C3%B3%C5%82w-lesson-generator.zip"


# ---------- the routes ----------

def test_the_listing_names_every_file_with_its_size(client):
    listing = client.get("/api/learning/generator").json()
    assert [f["name"] for f in listing] == NAMES
    assert [f["packed"] for f in listing] == [True] * 6 + [False] * 4
    by_name = {f["name"]: f for f in listing}
    assert by_name["GENERATE.md"]["size"] == os.path.getsize(os.path.join(REPO, "docs", "learning", "GENERATE.md"))
    assert by_name["ansi-60-en.json"]["size"] > 100_000
    assert "chat LLM" in by_name["PROMPT.md"]["description"]
    assert ".claude/skills/generate-lessons/" in by_name["SKILL.md"]["description"]


def test_a_file_downloads_as_an_attachment_of_its_name(client):
    response = client.get("/api/learning/generator/GENERATE.md")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    assert response.headers["content-disposition"] == 'attachment; filename="GENERATE.md"'
    with open(os.path.join(REPO, "docs", "learning", "GENERATE.md"), "rb") as inf:
        assert response.content == inf.read()
    schema = client.get("/api/learning/generator/lesson-set.schema.json")
    assert schema.headers["content-type"] == "application/json"
    assert schema.json()["$schema"]
    skill = client.get("/api/learning/generator/SKILL.md")
    assert skill.status_code == 200 and skill.text.startswith("---")


def test_an_unlisted_name_is_404(client):
    for name in ("nope.md", "..", "examples", "pack.zip", "layout-export.json"):
        response = client.get("/api/learning/generator/" + name)
        assert response.status_code == 404, name
    assert client.get("/api/learning/generator/" + "x" * 65).status_code == 422


def test_the_pack_downloads_with_the_keyboard_export_in_it(client, tmp_path):
    response = client.get("/api/learning/generator/pack")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == 'attachment; filename="Simulated Corne-lesson-generator.zip"'
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        assert zf.namelist() == PACKED + ["layout-export.json"]
        export = json.loads(zf.read("layout-export.json"))
    # the same export as the Export button gets (but for the moment it was made)
    again = client.get("/api/learning/export").json()
    assert {k: v for k, v in export.items() if k != "exportedAt"} == {k: v for k, v in again.items() if k != "exportedAt"}
    assert export["keyboard"] == {"name": "Simulated Corne", "uid": "5EEDC0DE00420042"}
    # saved as the Export button saves it
    saved = tmp_path / "learning" / "5EEDC0DE00420042" / "layout-export.json"
    assert json.loads(saved.read_text(encoding="utf-8"))["hash"] == export["hash"]


def test_the_pack_follows_the_keyboard_language(client):
    response = client.get("/api/learning/generator/pack?lang=dvorak")
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        export = json.loads(zf.read("layout-export.json"))
    assert export["language"] == "dvorak"
    assert export["hash"] != client.get("/api/learning/export").json()["hash"]
    assert client.get("/api/learning/generator/pack?lang=nope").status_code == 422


def test_without_a_store_the_files_are_served_but_not_the_pack(tmp_path):
    client = make_client(tmp_path, with_store=False)
    try:
        assert client.get("/api/learning/generator").status_code == 200
        assert client.get("/api/learning/generator/PROMPT.md").status_code == 200
        assert client.get("/api/learning/generator/pack").status_code == 501
    finally:
        client.__exit__(None, None, None)
