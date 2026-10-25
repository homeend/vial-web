""" The build record and the Version page's facts (buildinfo, GET /api/version) """
import json
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

import buildinfo
import resources
import version
from server.app import create_app
from server.device import DeviceManager, FakeBackend
from server.names import NamesStore
from simulator.corne import make_corne

TOKEN = "test-token"
PORT = 8767
BASE = "http://127.0.0.1:{}".format(PORT)
CI_ENV = {"GITHUB_RUN_ID": "123", "GITHUB_SERVER_URL": "https://github.com", "GITHUB_REPOSITORY": "homeend/vial-web",
          "GITHUB_REF_NAME": "v1.2.0", "RUNNER_OS": "Windows"}


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
def checkout(tmp_path):
    """ A small git checkout with one commit, on branch "work" """
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q", "-b", "work")
    git(root, "config", "user.email", "t@example.com")
    git(root, "config", "user.name", "t")
    (root / "a.txt").write_text("a", encoding="utf-8")
    git(root, "add", "a.txt")
    git(root, "commit", "-q", "-m", "one")
    return root


def test_git_state_reads_the_checkout(checkout):
    state = buildinfo.git_state(str(checkout))
    assert state == {"commit": git(checkout, "rev-parse", "HEAD"), "branch": "work", "dirty": False}
    assert len(state["commit"]) == 40
    (checkout / "a.txt").write_text("b", encoding="utf-8")
    assert buildinfo.git_state(str(checkout))["dirty"] is True
    git(checkout, "checkout", "-q", "--detach")
    assert buildinfo.git_state(str(checkout))["branch"] is None


def test_git_state_is_none_outside_a_checkout_or_without_git(tmp_path, monkeypatch):
    assert buildinfo.git_state(str(tmp_path)) is None
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("git")))
    assert buildinfo.git_state(resources.SOURCE_ROOT) is None


def test_describe_records_the_commit_the_ci_run_and_the_builder(checkout):
    (checkout / "web" / "dist").mkdir(parents=True)
    (checkout / "web" / "dist" / "index.html").write_text("<!doctype html>", encoding="utf-8")
    os.utime(checkout / "web" / "dist" / "index.html", (1_700_000_000, 1_700_000_000))
    record = buildinfo.describe(str(checkout), CI_ENV, now=1_700_003_600)
    assert record["builtAt"] == "2023-11-14T23:13:20Z" and record["webUiBuiltAt"] == "2023-11-14T22:13:20Z"
    assert record["commit"] == git(checkout, "rev-parse", "HEAD") and record["branch"] == "work"
    assert record["dirty"] is False
    assert record["ciRun"] == "123" and record["ciRef"] == "v1.2.0" and record["runner"] == "Windows"
    assert record["ciUrl"] == "https://github.com/homeend/vial-web/actions/runs/123"
    assert record["builderSystem"] and record["builderPython"] == "{}.{}.{}".format(*sys.version_info[:3])
    # not on CI: no run; a detached checkout (CI's) takes the ref as its branch only on CI
    local = buildinfo.describe(str(checkout), {}, now=0)
    assert local["ciRun"] is None and local["ciUrl"] is None and local["ciRef"] is None and local["runner"] is None
    assert local["webUiBuiltAt"] == "2023-11-14T22:13:20Z"
    git(checkout, "checkout", "-q", "--detach")
    assert buildinfo.describe(str(checkout), CI_ENV)["branch"] == "v1.2.0"
    assert buildinfo.describe(str(checkout), {})["branch"] is None


def test_write_then_read_bundled_round_trips(checkout, tmp_path, monkeypatch):
    path = tmp_path / "unpacked" / buildinfo.FILE_NAME
    buildinfo.write(str(checkout), str(path), CI_ENV, now=1_700_003_600)
    assert json.loads(path.read_text(encoding="utf-8"))["ciRun"] == "123"
    assert buildinfo.read_bundled() is None  # from source
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "unpacked"), raising=False)
    assert buildinfo.read_bundled()["builtAt"] == "2023-11-14T23:13:20Z"
    path.write_text("[1]", encoding="utf-8")
    assert buildinfo.read_bundled() is None  # not a record
    path.unlink()
    assert buildinfo.read_bundled() is None  # an older executable


def test_info_from_source_says_the_checkout(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    facts = buildinfo.info(1_700_003_600, fake=True, data_dir="D:/data", log_file="D:/data/vial.log")
    assert facts["product"] == version.PRODUCT and facts["version"] == version.VERSION
    assert facts["kind"] == "source" and facts["sourceRoot"] == resources.SOURCE_ROOT and facts["executable"] is None
    assert facts["build"] is None and facts["startedAt"] == "2023-11-14T23:13:20Z"
    assert facts["platform"] == sys.platform and facts["system"] and facts["python"].startswith("CPython ")
    assert facts["fake"] is True and facts["dataDir"] == "D:/data" and facts["logFile"] == "D:/data/vial.log"
    # the repository is a checkout here: its commit, unless git is missing on this machine
    state = buildinfo.git_state(resources.SOURCE_ROOT)
    assert facts["commit"] == (state or {}).get("commit") and facts["branch"] == (state or {}).get("branch")


def test_info_frozen_takes_the_commit_from_the_build_record(checkout, tmp_path, monkeypatch):
    unpacked = tmp_path / "unpacked"
    buildinfo.write(str(checkout), str(unpacked / buildinfo.FILE_NAME), CI_ENV, now=1_700_003_600)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(unpacked), raising=False)
    facts = buildinfo.info(0, fake=False)
    assert facts["kind"] == "executable" and facts["executable"] == sys.executable and facts["sourceRoot"] is None
    assert facts["commit"] == git(checkout, "rev-parse", "HEAD") and facts["branch"] == "work"
    assert facts["build"]["ciRun"] == "123" and facts["dataDir"] is None
    (unpacked / buildinfo.FILE_NAME).unlink()
    older = buildinfo.info(0, fake=False)
    assert older["build"] is None and older["commit"] is None and older["kind"] == "executable"


def test_the_version_route_answers_without_a_keyboard(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))  # never connected
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     data_dir=str(tmp_path), log_file=str(tmp_path / "vial.log"))
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        reply = client.get("/api/version")
        assert reply.status_code == 200
        facts = reply.json()
        assert facts["product"] == version.PRODUCT and facts["version"] == version.VERSION
        assert facts["kind"] == "source" and facts["fake"] is True
        assert facts["dataDir"] == str(tmp_path) and facts["logFile"] == str(tmp_path / "vial.log")
        assert facts["startedAt"].endswith("Z") and facts["build"] is None
        assert client.get("/api/session").json()["status"] == "disconnected"
