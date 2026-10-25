import json
import os
import sys

import pytest

import resources
from protocol.qmk_settings_codec import QmkSettingsCodec

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))


@pytest.fixture
def frozen(monkeypatch, tmp_path):
    """ Running as the one-file executable, unpacked to tmp_path """
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    return tmp_path


@pytest.fixture
def from_source(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)


@pytest.fixture
def source_root(monkeypatch, tmp_path):
    """ A repository at tmp_path holding the resources, but no web UI built """
    monkeypatch.setattr(resources, "SOURCE_ROOT", str(tmp_path))
    settings = tmp_path / "src" / "main" / "resources" / "base"
    settings.mkdir(parents=True)
    (settings / "qmk_settings.json").write_text('{"tabs": []}', encoding="utf-8")
    icons = tmp_path / "src" / "main" / "icons"
    icons.mkdir(parents=True)
    (icons / "Icon.ico").write_bytes(b"")
    docs = tmp_path / "docs" / "learning"
    docs.mkdir(parents=True)
    (docs / "GENERATE.md").write_text("# Generating a lesson set", encoding="utf-8")
    skill = tmp_path / ".claude" / "skills" / "generate-lessons"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: generate-lessons\n---", encoding="utf-8")
    return tmp_path


def build_web_ui(root):
    dist = root / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("", encoding="utf-8")


def test_source_root_is_the_repository():
    assert os.path.normcase(resources.SOURCE_ROOT) == os.path.normcase(REPO)
    assert os.path.isfile(os.path.join(resources.SOURCE_ROOT, "src", "main", "python", "resources.py"))


def test_from_source_the_repository_files_are_read(from_source):
    assert not resources.is_frozen()
    assert resources.path(resources.WEB_DIST) == os.path.join(REPO, "web", "dist")
    settings = resources.path(resources.QMK_SETTINGS)
    assert settings == os.path.join(REPO, "src", "main", "resources", "base", "qmk_settings.json")
    assert os.path.isfile(settings)


def test_frozen_the_unpacked_folder_is_read(frozen):
    assert resources.is_frozen()
    assert resources.path(resources.WEB_DIST) == os.path.join(str(frozen), "web")
    assert resources.path(resources.QMK_SETTINGS) == os.path.join(str(frozen), "qmk_settings.json")


def test_frozen_by_another_tool_without_an_unpacked_folder_reads_the_repository(monkeypatch):
    # sys.frozen alone (another freezer, that sets only sys.frozen) is not a PyInstaller build
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    assert not resources.is_frozen()
    assert resources.path(resources.WEB_DIST) == os.path.join(REPO, "web", "dist")


def test_settings_definitions_are_read_from_the_unpacked_folder_when_frozen(frozen, monkeypatch):
    with open(os.path.join(REPO, "src", "main", "resources", "base", "qmk_settings.json"), encoding="utf-8") as inf:
        definitions = json.load(inf)
    definitions["tabs"] = definitions["tabs"][:1]
    (frozen / "qmk_settings.json").write_text(json.dumps(definitions), encoding="utf-8")
    monkeypatch.setattr(QmkSettingsCodec, "settings_defs", None)
    monkeypatch.setattr(QmkSettingsCodec, "qsid_fields", None)
    QmkSettingsCodec.load()
    assert QmkSettingsCodec.settings_defs == definitions


@pytest.mark.parametrize("missing", ["file", "garbled"])
def test_settings_definitions_that_fail_to_load_are_tried_again_next_time(monkeypatch, tmp_path, missing):
    """ A failed load leaves nothing half-loaded: the next use tries again (and fails again), instead of finding every
    setting unsupported from then on """
    monkeypatch.setattr(QmkSettingsCodec, "settings_defs", None)
    monkeypatch.setattr(QmkSettingsCodec, "qsid_fields", None)
    path = tmp_path / "qmk_settings.json"
    if missing == "garbled":
        path.write_text('{"tabs": [{"fields": [{"no qsid": 1}]}]}', encoding="utf-8")
    monkeypatch.setattr(resources, "path", lambda resource: str(path))
    for attempt in range(2):
        with pytest.raises((OSError, KeyError)):
            QmkSettingsCodec.is_qsid_supported(1)
        assert QmkSettingsCodec.qsid_fields is None and QmkSettingsCodec.settings_defs is None


def test_web_ui_missing_says_how_to_build_it(from_source, source_root):
    problem = resources.web_ui_missing()
    assert problem is not None
    assert os.path.join(str(source_root), "web", "dist", "index.html") in problem
    assert "cd web && npm ci && npm run build" in problem
    build_web_ui(source_root)
    assert resources.web_ui_missing() is None


def test_web_ui_missing_when_frozen_looks_in_the_unpacked_folder(frozen):
    assert resources.web_ui_missing() is not None
    (frozen / "web").mkdir()
    (frozen / "web" / "index.html").write_text("<!doctype html>", encoding="utf-8")
    assert resources.web_ui_missing() is None


def test_pyinstaller_datas_put_each_resource_at_its_bundled_path(from_source, source_root):
    build_web_ui(source_root)
    assert resources.pyinstaller_datas() == [
        (os.path.join(str(source_root), "web", "dist"), "web"),
        (os.path.join(str(source_root), "src", "main", "resources", "base", "qmk_settings.json"), "."),
        (os.path.join(str(source_root), "src", "main", "icons", "Icon.ico"), "."),
        (os.path.join(str(source_root), "docs", "learning"), "docs/learning"),
        (os.path.join(str(source_root), ".claude", "skills", "generate-lessons", "SKILL.md"),
         "skills/generate-lessons"),
    ]


def test_pyinstaller_datas_look_at_the_repository_only(source_root, monkeypatch, tmp_path_factory):
    """ even run from a PyInstaller build: the web UI in the build's own folder is not what a new build bundles """
    unpacked = tmp_path_factory.mktemp("unpacked")
    (unpacked / "web").mkdir()
    (unpacked / "web" / "index.html").write_text("<!doctype html>", encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(unpacked), raising=False)
    with pytest.raises(FileNotFoundError, match="npm run build"):
        resources.pyinstaller_datas()  # the repository has none
    build_web_ui(source_root)
    (unpacked / "web" / "index.html").unlink()
    assert resources.pyinstaller_datas()[0] == (os.path.join(str(source_root), "web", "dist"), "web")


def test_pyinstaller_datas_refuse_a_build_without_the_web_ui(from_source, source_root):
    with pytest.raises(FileNotFoundError, match="npm run build"):
        resources.pyinstaller_datas()


def test_pyinstaller_datas_refuse_a_build_without_a_resource(from_source, source_root):
    build_web_ui(source_root)
    os.remove(os.path.join(str(source_root), "src", "main", "resources", "base", "qmk_settings.json"))
    with pytest.raises(FileNotFoundError, match="qmk_settings.json"):
        resources.pyinstaller_datas()
