import pytest

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


def test_a_complete_build_has_no_problems(web_ui_built):
    imports = Imports()
    assert selfcheck.problems(imports) == []
    assert imports.imported == ["hidproxy", *selfcheck.SERVER_MODULES]


def test_hidapi_not_loading_is_a_problem(web_ui_built):
    assert selfcheck.problems(Imports(failing=("hidproxy",))) == [
        "hidapi can't be loaded: DLL load failed while importing hid"]


def test_a_server_module_missing_is_a_problem(web_ui_built):
    found = selfcheck.problems(Imports(failing=("uvicorn.lifespan.on",)))
    assert found == ["uvicorn.lifespan.on can't be imported: DLL load failed while importing hid"]


def test_the_web_ui_or_the_settings_missing_is_a_problem(monkeypatch, tmp_path):
    monkeypatch.setattr(resources, "SOURCE_ROOT", str(tmp_path))  # a checkout with nothing built or bundled
    found = selfcheck.problems(Imports())
    assert len(found) == 2
    assert "the web UI isn't built" in found[0]
    assert found[1].startswith("the QMK settings can't be read")


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


def test_the_self_check_imports_what_uvicorn_imports_by_name():
    # uvicorn's "auto" choices, and the implementations they pick here (vial.spec's hidden imports)
    for name in ("uvicorn.loops.auto", "uvicorn.loops.asyncio", "uvicorn.protocols.http.auto",
                 "uvicorn.protocols.http.h11_impl", "uvicorn.protocols.websockets.auto",
                 "uvicorn.protocols.websockets.websockets_sansio_impl", "uvicorn.lifespan.on"):
        assert name in selfcheck.SERVER_MODULES
