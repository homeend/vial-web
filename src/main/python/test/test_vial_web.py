import http.server
import json
import os
import socket
import struct
import sys
import threading

import pytest
import uvicorn

import vial_web
from protocol.unlock_hook import set_unlock_handler
from server.device import DeviceManager, HidBackend
from test.test_core_isolation import run_isolated

LAYOUT_2x2 = {"name": "Tiny", "matrix": {"rows": 2, "cols": 2},
              "layouts": {"keymap": [["0,0", "0,1"], ["1,0", "1,1"]]}}
LIVE_URL = "http://127.0.0.1:4321/?token=abc"


@pytest.fixture(autouse=True)
def reset_unlock_handler():
    """ main() installs the server's unlock handler globally """
    yield
    set_unlock_handler(None)


@pytest.fixture
def home(tmp_path, monkeypatch):
    """ Keeps the data dir (log, server.json) and the config dir in tmp_path, and the browser closed.
    Returns the list of URLs main() asked the browser to open. """
    monkeypatch.setattr(vial_web, "data_dir", lambda: str(tmp_path / "data"))
    monkeypatch.setattr(vial_web.platformdirs, "user_config_dir", lambda *a, **k: str(tmp_path / "config"))
    monkeypatch.setattr(vial_web, "setup_logging", lambda: None)
    opened = []
    monkeypatch.setattr(vial_web.webbrowser, "open", lambda url, *a, **k: opened.append(url))
    return opened


@pytest.fixture
def no_keyboard(monkeypatch):
    """ Fails the test as soon as anything tries to find or open a keyboard, real or simulated """
    def refuse(*args, **kwargs):
        raise AssertionError("touched a keyboard")
    monkeypatch.setattr(vial_web, "make_backend", refuse)
    monkeypatch.setattr(DeviceManager, "connect", refuse)
    monkeypatch.setattr(HidBackend, "find", refuse)
    monkeypatch.setattr(HidBackend, "open", refuse)
    monkeypatch.setattr(HidBackend, "present", refuse)


def unused_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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


@pytest.mark.parametrize("port", ["-1", "65536", "http", "1.5"])
def test_port_must_be_a_port_number(port):
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--port", port])


def test_port_range():
    assert vial_web.parse_args(["--port", "0"]).port == 0
    assert vial_web.parse_args(["--port", "65535"]).port == 65535


def test_messages_include_the_url():
    url = "http://127.0.0.1:1234/?token=abc"
    assert url in vial_web.REOPEN_MESSAGE.format(url=url)
    assert "simulated" in vial_web.STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard")


# ---------- a second launch ----------

@pytest.mark.parametrize("argv", [["--fake"], [], ["--fake", "--layout", "x.vil"]])
def test_second_launch_opens_the_running_one_without_touching_the_keyboard(home, no_keyboard, monkeypatch,
                                                                            capsys, argv):
    monkeypatch.setattr(vial_web, "running_session", lambda: LIVE_URL)
    assert vial_web.main(argv) == 0
    assert home == [LIVE_URL]
    assert LIVE_URL in capsys.readouterr().out


def test_second_launch_without_browser_prints_the_url(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda: LIVE_URL)
    assert vial_web.main(["--no-browser"]) == 0
    assert home == []
    assert LIVE_URL in capsys.readouterr().out


def test_real_dry_run_refuses_while_vial_is_running(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda: LIVE_URL)
    assert vial_web.main(["--dry-run"]) != 0
    assert "already running" in capsys.readouterr().err


# ---------- a launch while another one is starting up ----------

@pytest.fixture
def other_instance(home):
    """ Another Vial that has claimed the instance and is still connecting to the keyboard """
    claim = vial_web.claim_instance()
    assert claim is not None
    yield
    vial_web.release_instance(claim)


def test_instance_claim_is_exclusive(home):
    claim = vial_web.claim_instance()
    assert claim is not None
    assert vial_web.claim_instance() is None
    vial_web.release_instance(claim)
    claim = vial_web.claim_instance()
    assert claim is not None
    vial_web.release_instance(claim)


def test_launch_while_another_is_starting_waits_for_it(home, no_keyboard, other_instance, monkeypatch, capsys):
    answers = iter([None, None, None, LIVE_URL])
    monkeypatch.setattr(vial_web, "running_session", lambda: next(answers))
    waits = []
    monkeypatch.setattr(vial_web.time, "sleep", waits.append)
    assert vial_web.main(["--fake"]) == 0
    assert home == [LIVE_URL]
    assert LIVE_URL in capsys.readouterr().out
    assert len(waits) == 2  # the first check found nothing; two more while waiting, then the answer


def test_launch_gives_up_on_one_that_never_answers(home, no_keyboard, other_instance, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda: None)
    monkeypatch.setattr(vial_web, "STARTUP_WAIT", 0.3)
    assert vial_web.main([]) == 1
    out, err = capsys.readouterr()
    assert "did not answer within 0.3 seconds" in err
    assert "Traceback" not in err and "Open it at" not in out
    assert home == []


def test_real_dry_run_refuses_while_another_is_starting(home, no_keyboard, other_instance, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda: None)
    assert vial_web.main(["--dry-run"]) != 0
    assert "already running" in capsys.readouterr().err


# ---------- binding the port ----------

def test_bind_socket_listens_on_localhost_only():
    with vial_web.bind_socket(0) as sock:
        host, port = sock.getsockname()
        assert host == "127.0.0.1" and 0 < port <= 65535
        with pytest.raises(OSError):
            vial_web.bind_socket(port)


def test_busy_port_is_a_clear_error_before_anything_is_announced(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda: None)
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen()
        port = taken.getsockname()[1]
        assert vial_web.main(["--fake", "--port", str(port)]) == 1
    out, err = capsys.readouterr()
    assert "could not listen on port {}".format(port) in err
    assert "Traceback" not in err
    assert "Open it at" not in out
    assert home == []
    assert not os.path.exists(vial_web.session_file())


class FakeServer:
    """ Stands in for uvicorn.Server: records what main() set up by the time it starts serving """

    seen = {}
    while_serving = None

    def __init__(self, config):
        FakeServer.seen["app"] = config.app

    def run(self, sockets):
        (sock,) = sockets
        FakeServer.seen["address"] = sock.getsockname()
        with open(vial_web.session_file(), encoding="utf-8") as inf:
            FakeServer.seen["session"] = json.load(inf)
        if FakeServer.while_serving:
            FakeServer.while_serving()


@pytest.fixture
def fake_server(monkeypatch):
    FakeServer.seen, FakeServer.while_serving = {}, None
    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    monkeypatch.setattr(vial_web, "running_session", lambda: None)
    return FakeServer


def test_serving_announces_the_bound_port_and_cleans_up(home, fake_server, capsys):
    assert vial_web.main(["--fake"]) == 0
    seen = fake_server.seen
    host, port = seen["address"]
    assert host == "127.0.0.1"
    assert seen["session"]["port"] == port
    url = seen["session"]["url"]
    assert url.startswith("http://127.0.0.1:{}/?token=".format(port))
    assert url in capsys.readouterr().out
    for _ in range(100):  # the browser is opened from a thread
        if home:
            break
        threading.Event().wait(0.02)
    assert home == [url]
    assert not os.path.exists(vial_web.session_file())


def test_instance_is_claimed_before_connecting_and_released_at_exit(home, fake_server, monkeypatch):
    claimed_while_connecting = []
    connect = DeviceManager.connect

    def check_claim(manager):
        claim = vial_web.claim_instance()
        claimed_while_connecting.append(claim is None)
        if claim is not None:
            vial_web.release_instance(claim)
        return connect(manager)
    monkeypatch.setattr(DeviceManager, "connect", check_claim)
    fake_server.while_serving = lambda: claimed_while_connecting.append(vial_web.claim_instance() is None)
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert claimed_while_connecting == [True, True]
    claim = vial_web.claim_instance()
    assert claim is not None
    vial_web.release_instance(claim)


def test_cleanup_keeps_another_instances_session_file(home, fake_server):
    other = {"port": 1, "url": "http://127.0.0.1:1/", "instance": "another"}
    fake_server.while_serving = lambda: vial_web.write_session(other)
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    with open(vial_web.session_file(), encoding="utf-8") as inf:
        assert json.load(inf) == other


def test_ctrl_c_stops_cleanly(home, fake_server):
    def interrupt():
        raise KeyboardInterrupt  # uvicorn raises Ctrl+C again after shutting down
    fake_server.while_serving = interrupt
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert not os.path.exists(vial_web.session_file())


def test_layout_file_failure_is_a_clear_error(tmp_path, capsys):
    bad = tmp_path / "bad.vil"
    bad.write_text("this is not json", encoding="utf-8")
    assert vial_web.main(["--fake", "--layout", str(bad), "--dry-run"]) == 1
    err = capsys.readouterr().err
    assert "could not load the layout file" in err and "Traceback" not in err
    assert vial_web.main(["--fake", "--layout", str(tmp_path / "missing.vil"), "--dry-run"]) == 1
    assert "could not load the layout file" in capsys.readouterr().err


# ---------- the session file ----------

def test_session_file_is_written_atomically(home, tmp_path):
    vial_web.write_session({"port": 1, "url": "u", "instance": "a"})
    vial_web.write_session({"port": 2, "url": "v", "instance": "b"})
    assert os.listdir(tmp_path / "data") == ["server.json"]
    with open(vial_web.session_file(), encoding="utf-8") as inf:
        assert json.load(inf)["instance"] == "b"


@pytest.mark.skipif(os.name == "nt", reason="POSIX permissions")
def test_session_file_is_private(home, tmp_path):
    vial_web.write_session({"port": 1, "url": "u", "instance": "a"})
    assert os.stat(tmp_path / "data").st_mode & 0o777 == 0o700
    assert os.stat(vial_web.session_file()).st_mode & 0o777 == 0o600


def test_cleanup_removes_only_our_session_file(home):
    vial_web.write_session({"port": 1, "url": "u", "instance": "theirs"})
    vial_web.remove_session("ours")
    assert os.path.exists(vial_web.session_file())
    vial_web.remove_session("theirs")
    assert not os.path.exists(vial_web.session_file())
    vial_web.remove_session("theirs")  # already gone: no error


# ---------- finding a running instance ----------

class Health:
    """ A stand-in health endpoint on 127.0.0.1 answering with a fixed body """

    def __init__(self, body):
        payload = body if isinstance(body, bytes) else json.dumps(body).encode()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass
        self.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def health():
    servers = []

    def start(body):
        servers.append(Health(body))
        return servers[-1]
    yield start
    for s in servers:
        s.close()


def write_session_file(content):
    os.makedirs(vial_web.data_dir(), exist_ok=True)
    with open(vial_web.session_file(), "w", encoding="utf-8") as outf:
        outf.write(content if isinstance(content, str) else json.dumps(content))


def session_for(port, instance="abc"):
    return {"port": port, "url": "http://127.0.0.1:{}/?token=t".format(port), "instance": instance}


def test_no_running_session(home):
    assert vial_web.running_session() is None
    write_session_file(session_for(unused_port()))
    assert vial_web.running_session() is None


def test_running_session_is_found(home, health):
    server = health({"app": "vial", "instance": "abc"})
    write_session_file(session_for(server.port))
    assert vial_web.running_session() == session_for(server.port)["url"]


def test_running_session_ignores_http_proxies(home, health, monkeypatch):
    for name in ("http_proxy", "HTTP_PROXY"):
        monkeypatch.setenv(name, "http://127.0.0.1:{}".format(unused_port()))
    for name in ("no_proxy", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
    server = health({"app": "vial", "instance": "abc"})
    write_session_file(session_for(server.port))
    assert vial_web.running_session() == session_for(server.port)["url"]


def test_running_session_needs_the_same_instance(home, health):
    server = health({"app": "vial", "instance": "someone else"})
    write_session_file(session_for(server.port))
    assert vial_web.running_session() is None


@pytest.mark.parametrize("content", [
    "[]", '"a string"', "42", "null", "{not json", "",
    {"port": None, "url": "http://127.0.0.1:1/", "instance": "abc"},
    {"port": "1:2", "url": "http://127.0.0.1:1:2/", "instance": "abc"},
    {"port": "8000", "url": "http://127.0.0.1:8000/", "instance": "abc"},
    {"port": True, "url": "http://127.0.0.1:True/", "instance": "abc"},
    {"port": 70000, "url": "http://127.0.0.1:70000/", "instance": "abc"},
    {"port": 8000, "url": None, "instance": "abc"},
    {"port": 8000, "url": "http://127.0.0.1:8000/", "instance": ["abc"]},
    {"url": "http://127.0.0.1:8000/"},
])
def test_odd_session_files_are_ignored(home, content):
    write_session_file(content)
    assert vial_web.running_session() is None


def test_url_must_point_at_the_recorded_port(home, health):
    server = health({"app": "vial", "instance": "abc"})
    write_session_file(dict(session_for(server.port), url="http://example.com/"))
    assert vial_web.running_session() is None


@pytest.mark.parametrize("body", [["not", "a", "dict"], "vial", None, b"\xff\xfe garbage", b""])
def test_odd_health_replies_are_ignored(home, health, body):
    server = health(body)
    write_session_file(session_for(server.port))
    assert vial_web.running_session() is None


def test_connection_reset_is_ignored(home):
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()

    def reset():
        conn, _ = listener.accept()
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        conn.close()  # with a zero linger time: a TCP reset
    thread = threading.Thread(target=reset, daemon=True)
    thread.start()
    try:
        write_session_file(session_for(listener.getsockname()[1]))
        assert vial_web.running_session() is None
    finally:
        thread.join(2)
        listener.close()
