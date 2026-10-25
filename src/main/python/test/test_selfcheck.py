import ast
import importlib.util
import os
import sys

import pytest
import uvicorn

import resources
import selfcheck
import vial_web


class Imports:
    """ Stands in for importlib.import_module: records what is imported (nothing is), and fails for some names """

    def __init__(self, failing=()):
        self.failing = failing
        self.imported = []

    def __call__(self, name):
        self.imported.append(name)
        if name in self.failing:
            raise ImportError("DLL load failed while importing hid")


@pytest.fixture
def web_ui_built(monkeypatch):
    monkeypatch.setattr(resources, "web_ui_missing", lambda: None)


def tray_loads():
    return (object(), object()), None


def test_a_complete_build_has_no_problems(web_ui_built):
    imports = Imports()
    assert selfcheck.problems(imports, platform="win32", load_tray=tray_loads) == []
    assert imports.imported == ["hidproxy", *selfcheck.SERVER_MODULES]


def test_a_complete_linux_build_checks_the_tray_module_by_module(web_ui_built):
    """ importing pystray on Linux opens the display, which the CI's runners have none of """
    imports = Imports()
    assert selfcheck.problems(imports, platform="linux", load_tray=lambda: (None, "must not be called")) == []
    assert imports.imported == ["hidproxy", *selfcheck.SERVER_MODULES, *selfcheck.LINUX_TRAY_MODULES]


def test_hidapi_not_loading_is_a_problem(web_ui_built):
    assert selfcheck.problems(Imports(failing=("hidproxy",)), platform="win32", load_tray=tray_loads) == [
        "hidapi can't be loaded: DLL load failed while importing hid"]


def test_a_server_module_missing_is_a_problem(web_ui_built):
    found = selfcheck.problems(Imports(failing=("uvicorn.lifespan.on",)), platform="win32", load_tray=tray_loads)
    assert found == ["uvicorn.lifespan.on can't be imported: DLL load failed while importing hid"]


@pytest.mark.parametrize("platform", ["win32", "darwin"])
def test_the_tray_not_loading_is_a_problem(web_ui_built, platform):
    found = selfcheck.problems(Imports(), platform=platform, load_tray=lambda: (None, "ImportError: no pystray"))
    assert found == ["the tray icon's libraries can't be loaded: ImportError: no pystray"]


def test_a_tray_module_missing_on_linux_is_a_problem(web_ui_built):
    found = selfcheck.problems(Imports(failing=("Xlib.display",)), platform="linux")
    assert found == ["the tray icon's Xlib.display can't be imported: DLL load failed while importing hid"]


def test_the_self_check_loads_the_tray_as_vial_does():
    """ by default: the real tray.load(), on this system (Linux: its modules, without opening the display) """
    import tray
    assert selfcheck.problems.__defaults__[2] is tray.load
    if not sys.platform.startswith("linux"):
        loaded, problem = tray.load()
        assert loaded is not None, problem


def test_the_web_ui_the_settings_or_the_generator_files_missing_is_a_problem(monkeypatch, tmp_path):
    monkeypatch.setattr(resources, "SOURCE_ROOT", str(tmp_path))  # a checkout with nothing built or bundled
    found = selfcheck.problems(Imports(), platform="win32", load_tray=tray_loads)
    assert len(found) == 3
    assert "the web UI isn't built" in found[0]
    assert found[1].startswith("the QMK settings can't be read")
    assert found[2] == "the lesson generator's files are missing: PROMPT.md, GENERATE.md, lesson-rules.md, " \
        "lesson-format.md, lesson-set.schema.json, corne-sim-en.json, corne-sim-layout-export.json, ansi-60-en.json, " \
        "course-method.md, SKILL.md"


def test_one_generator_file_missing_is_named(monkeypatch, tmp_path, web_ui_built):
    import shutil
    root = tmp_path / "repo"
    shutil.copytree(os.path.join(resources.SOURCE_ROOT, "docs", "learning"), root / "docs" / "learning")
    shutil.copytree(os.path.join(resources.SOURCE_ROOT, ".claude", "skills"), root / ".claude" / "skills")
    settings = root / "src" / "main" / "resources" / "base"
    settings.mkdir(parents=True)
    shutil.copy(resources.path(resources.QMK_SETTINGS), settings / "qmk_settings.json")
    monkeypatch.setattr(resources, "SOURCE_ROOT", str(root))
    assert selfcheck.problems(Imports(), platform="win32", load_tray=tray_loads) == []
    (root / "docs" / "learning" / "examples" / "ansi-60-en.json").unlink()
    (root / ".claude" / "skills" / "generate-lessons" / "SKILL.md").unlink()
    assert selfcheck.problems(Imports(), platform="win32", load_tray=tray_loads) == [
        "the lesson generator's files are missing: ansi-60-en.json, SKILL.md"]


@pytest.mark.parametrize("found, code", [([], 0), (["hidapi can't be loaded: no"], 1)])
def test_vial_self_check_says_what_is_missing_and_never_looks_for_a_keyboard(monkeypatch, capsys, tmp_path, found,
                                                                           code):
    monkeypatch.setattr(selfcheck, "problems", lambda: found)

    def refuse(*args, **kwargs):
        raise AssertionError("looked for a keyboard, or used the data dir")
    monkeypatch.setattr(vial_web, "make_backend", refuse)
    monkeypatch.setattr(vial_web, "claim_instance", refuse)
    monkeypatch.setattr(vial_web, "setup_logging", refuse)
    assert vial_web.main(["--self-check"]) == code
    out = capsys.readouterr().out
    if found:
        assert "this build is incomplete" in out and "  - hidapi can't be loaded: no" in out
    else:
        assert "this build has everything it needs" in out and "No keyboard was looked for." in out


SPEC = os.path.join(resources.SOURCE_ROOT, "vial.spec")


def uvicorn_imports_by_name():
    """ The modules uvicorn imports by name as Vial runs it, from uvicorn's own tables: its "auto" choices (Vial sets
    none of loop, http, ws and lifespan), and the implementations they pick here """
    from uvicorn import config
    from uvicorn.protocols.http.auto import AutoHTTPProtocol
    from uvicorn.protocols.websockets.auto import AutoWebSocketsProtocol
    defaults = uvicorn.Config(None)
    assert (defaults.loop, defaults.http, defaults.ws, defaults.lifespan) == ("auto", "auto", "auto", "auto")
    names = {table["auto"].split(":")[0]
             for table in (config.LOOP_FACTORIES, config.HTTP_PROTOCOLS, config.WS_PROTOCOLS, config.LIFESPAN)}
    # uvicorn.loops.auto picks uvloop's loop if it can import uvloop (Vial doesn't install it)
    names.add("uvicorn.loops.uvloop" if importlib.util.find_spec("uvloop") else "uvicorn.loops.asyncio")
    names.add(AutoHTTPProtocol.__module__)
    names.add(AutoWebSocketsProtocol.__module__)
    return names


def spec_hidden_imports():
    """ the names in vial.spec's HIDDEN_IMPORTS """
    with open(SPEC, encoding="utf-8") as inf:
        tree = ast.parse(inf.read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and [getattr(t, "id", None) for t in node.targets] == ["HIDDEN_IMPORTS"]:
            return {n.value for n in ast.walk(node.value) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    raise AssertionError("vial.spec has no HIDDEN_IMPORTS")


def test_the_self_check_imports_what_uvicorn_imports_by_name():
    expected = uvicorn_imports_by_name()
    assert {"uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.lifespan.on"} <= expected
    assert {name for name in selfcheck.SERVER_MODULES if name.startswith("uvicorn.")} == expected


def test_the_executable_bundles_what_uvicorn_imports_by_name():
    assert uvicorn_imports_by_name() <= spec_hidden_imports()
