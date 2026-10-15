import json

import pytest

import vial_web
from test.test_core_isolation import run_isolated

LAYOUT_2x2 = {"name": "Tiny", "matrix": {"rows": 2, "cols": 2},
              "layouts": {"keymap": [["0,0", "0,1"], ["1,0", "1,1"]]}}


def test_fake_mode_never_loads_qt_or_hidapi():
    """ The guarantee behind 'development never touches real hardware' """
    result = run_isolated("import sys, vial_web\nsys.exit(vial_web.main(['--fake', '--dry-run']))")
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    assert summary == {"device": "Simulated: Simulated Corne", "name": "Simulated Corne", "layers": 4,
                       "keys": 42, "fake": True}


def test_fake_mode_with_custom_definition(tmp_path, capsys):
    path = tmp_path / "vial.json"
    path.write_text(json.dumps(LAYOUT_2x2), encoding="utf-8")
    assert vial_web.main(["--fake", "--definition", str(path), "--dry-run"]) == 0
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (summary["name"], summary["keys"]) == ("Tiny", 4)


def test_definition_requires_fake():
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--definition", "x.json"])


def test_messages_include_the_url():
    url = "http://127.0.0.1:1234/?token=abc"
    assert url in vial_web.REOPEN_MESSAGE.format(url=url)
    assert "simulated" in vial_web.STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard")


def test_no_running_session(tmp_path, monkeypatch):
    monkeypatch.setattr(vial_web, "data_dir", lambda: str(tmp_path))
    assert vial_web.running_session() is None
    (tmp_path / "server.json").write_text(json.dumps({"port": vial_web.free_port(), "url": "x", "instance": "y"}))
    assert vial_web.running_session() is None


def test_free_port_is_usable():
    assert 1024 <= vial_web.free_port() <= 65535
