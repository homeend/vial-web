import http.server
import json
import logging
import os
import socket
import struct
import subprocess
import sys
import threading

import pytest
import uvicorn

import vial_web
from protocol.unlock_hook import set_unlock_handler
from server import device as device_module
from server.device import DeviceManager, HidBackend
from simulator.corne import encode
from simulator.device import SimulatedHidDevice
from test.test_core_isolation import run_isolated

LAYOUT_2x2 = {"name": "Tiny", "matrix": {"rows": 2, "cols": 2},
              "layouts": {"keymap": [["0,0", "0,1"], ["1,0", "1,1"]]}}
LIVE_URL = "http://127.0.0.1:4321/?token=abc"


@pytest.fixture(autouse=True)
def reset_unlock_handler():
    """ main() installs the server's unlock handler globally """
    yield
    set_unlock_handler(None)


@pytest.fixture(autouse=True)
def reset_data_dir():
    """ main(["--data-dir", ...]) and use_data_dir() choose the data dir for the whole process """
    yield
    vial_web.use_data_dir(None)


@pytest.fixture
def home(tmp_path, monkeypatch):
    """ Keeps the data dirs (log, server.json) and the config dirs of both modes in tmp_path, and the browser closed.
    Returns the list of URLs main() asked the browser to open. """
    monkeypatch.setattr(vial_web.platformdirs, "user_data_dir", lambda *a, **k: str(tmp_path / "data"))
    monkeypatch.setattr(vial_web.platformdirs, "user_config_dir", lambda *a, **k: str(tmp_path / "config"))
    monkeypatch.setattr(vial_web, "setup_logging", lambda fake: None)
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
    """ The guarantee behind 'development never touches real hardware'. The server and uvicorn are imported too: they
    must never pull in Qt or hidapi when imported. """
    result = run_isolated("import sys, vial_web, server.app, uvicorn, uvicorn.main\n"
                          "sys.exit(vial_web.main(['--fake', '--dry-run']))")
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


def test_dry_run_says_a_keyboard_waits_for_its_unlock_and_leaves_it_waiting(monkeypatch, capsys):
    """ A simulated Corne still waiting for an unlock started earlier: it is found, but can't be read until its unlock
    keys are held. --dry-run says so, and sends it nothing that would start its countdown over. """
    from protocol.keyboard_comm import Keyboard
    from simulator import corne
    vk = corne.make_corne()
    vk.unlocked = False
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.unlock_start()
    vk.unlock_counter -= 1  # partway through its countdown
    counter = vk.unlock_counter
    monkeypatch.setattr(corne, "make_corne", lambda **kwargs: vk)
    starts = []
    monkeypatch.setattr(Keyboard, "unlock_start", lambda self: starts.append(self))

    assert vial_web.main(["--fake", "--dry-run"]) == 1
    out = capsys.readouterr().out
    assert "keyboard found: Simulated: Simulated Corne, waiting for its unlock keys" in out
    assert "no keyboard found" not in out
    assert starts == []
    assert vk.unlock_in_progress and vk.unlock_counter == counter


def test_definition_requires_fake():
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--definition", "x.json"])


@pytest.mark.parametrize("layers", [1, 8, 32])
def test_fake_mode_with_more_or_fewer_layers(capsys, layers):
    assert vial_web.main(["--fake", "--layers", str(layers), "--dry-run"]) == 0
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (summary["name"], summary["layers"]) == ("Simulated Corne", layers)


def test_fake_layers_default_to_the_simulators(tmp_path):
    from simulator import corne
    assert vial_web.make_backend(vial_web.parse_args(["--fake"])).keyboard_factory().layers == len(corne.LAYERS)
    path = tmp_path / "vial.json"
    path.write_text(json.dumps(LAYOUT_2x2), encoding="utf-8")
    custom = vial_web.make_backend(vial_web.parse_args(["--fake", "--definition", str(path)])).keyboard_factory()
    assert custom.layers == 4  # VirtualKeyboard's default


def test_extra_fake_layers_are_empty():
    from simulator import corne
    vk = vial_web.make_backend(vial_web.parse_args(["--fake", "--layers", "8"])).keyboard_factory()
    assert len(vk.keymap) == 8
    assert vk.keymap[:4] == corne.make_corne().keymap  # the sample's 4 layers, unchanged
    assert all(code == 0 for layer in vk.keymap[4:] for row in layer for code in row)


def test_layers_with_a_custom_definition(tmp_path, capsys):
    path = tmp_path / "vial.json"
    path.write_text(json.dumps(LAYOUT_2x2), encoding="utf-8")
    assert vial_web.main(["--fake", "--definition", str(path), "--layers", "6", "--dry-run"]) == 0
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (summary["name"], summary["layers"]) == ("Tiny", 6)


@pytest.mark.parametrize("layers", ["0", "33", "-1", "eight", "2.5"])
def test_layers_must_be_a_layer_count(layers, capsys):
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--fake", "--layers", layers])
    assert "layer count (1 to 32)" in capsys.readouterr().err


def test_layers_requires_fake(capsys):
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--layers", "8"])
    assert "only work with --fake" in capsys.readouterr().err


def test_fake_unlock_counter():
    from simulator.virtual_keyboard import FIRMWARE_UNLOCK_POLL_GAP, UNLOCK_COUNTER_MAX
    vk = vial_web.make_backend(vial_web.parse_args(["--fake", "--unlock-counter", "10"])).keyboard_factory()
    assert vk.unlock_counter_max == 10
    assert vk.unlock_poll_gap == FIRMWARE_UNLOCK_POLL_GAP  # still the firmware's timing
    assert vial_web.make_backend(vial_web.parse_args(["--fake"])).keyboard_factory().unlock_counter_max == \
        UNLOCK_COUNTER_MAX


@pytest.mark.parametrize("counter", ["0", "256", "-1", "ten", "2.5"])
def test_unlock_counter_must_be_a_countdown(counter, capsys):
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--fake", "--unlock-counter", counter])
    assert "unlock countdown (1 to 255)" in capsys.readouterr().err


def test_unlock_counter_requires_fake(capsys):
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--unlock-counter", "10"])
    assert "only work with --fake" in capsys.readouterr().err


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

def running_in_mode(fake):
    """ A stand-in for running_session(): a Vial of the given mode is running at LIVE_URL """
    return lambda asked: LIVE_URL if asked is fake else None


@pytest.mark.parametrize("argv", [["--fake"], [], ["--fake", "--layout", "x.vil"]])
def test_second_launch_opens_the_running_one_without_touching_the_keyboard(home, no_keyboard, monkeypatch,
                                                                            capsys, argv):
    monkeypatch.setattr(vial_web, "running_session", running_in_mode("--fake" in argv))
    assert vial_web.main(argv) == 0
    assert home == [LIVE_URL]
    assert LIVE_URL in capsys.readouterr().out


def test_second_launch_without_browser_prints_the_url(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", running_in_mode(False))
    assert vial_web.main(["--no-browser"]) == 0
    assert home == []
    assert LIVE_URL in capsys.readouterr().out


def test_real_dry_run_refuses_while_vial_is_running(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", running_in_mode(False))
    assert vial_web.main(["--dry-run"]) != 0
    assert "already running" in capsys.readouterr().err


# ---------- fake and real mode never share an instance ----------

def test_fake_and_real_use_different_files():
    """ Computed from the real platformdirs locations; nothing is created """
    paths = [vial_web.lock_file, vial_web.session_file, vial_web.log_file, vial_web.names_file]
    for path in paths:
        assert os.path.dirname(path(True)) != os.path.dirname(path(False))
    assert len({path(fake) for path in paths for fake in (True, False)}) == 8


def test_each_mode_logs_to_its_own_file(tmp_path, monkeypatch):
    monkeypatch.setattr(vial_web.platformdirs, "user_data_dir", lambda *a, **k: str(tmp_path / "data"))
    root = logging.getLogger()
    level, before = root.level, list(root.handlers)
    try:
        for fake in (True, False):
            vial_web.setup_logging(fake)
            (added,) = [h for h in root.handlers if h not in before]
            assert added.baseFilename == os.path.abspath(vial_web.log_file(fake))
            root.removeHandler(added)
            added.close()
    finally:
        root.setLevel(level)
        for handler in [h for h in root.handlers if h not in before]:
            root.removeHandler(handler)
            handler.close()
    assert vial_web.log_file(True) != vial_web.log_file(False)


def start_vial(health, fake):
    """ Another Vial of the given mode: its instance lock held, its session file written and answering.
    Returns (its URL, its claim). """
    server = health({"app": "vial", "instance": "other", "fake": fake})
    session = session_for(server.port, "other", fake)
    claim = vial_web.claim_instance(fake)
    assert claim is not None
    vial_web.write_session(session)
    assert vial_web.running_session(fake) == session["url"]  # found by a launch of its own mode
    return session["url"], claim


def test_fake_launch_starts_its_own_while_a_real_vial_runs(home, health, fake_server, capsys):
    real_url, claim = start_vial(health, fake=False)
    try:
        assert vial_web.main(["--fake", "--no-browser"]) == 0
        with open(vial_web.session_file(False), encoding="utf-8") as inf:
            assert json.load(inf)["url"] == real_url  # the real one's session is left alone
    finally:
        vial_web.release_instance(claim)
    out, err = capsys.readouterr()
    assert real_url not in out + err and "already running" not in out
    assert fake_server.seen["session"]["fake"] is True
    assert fake_server.seen["session"]["url"] in out and "with a simulated keyboard" in out


@pytest.mark.parametrize("argv", [[], ["--no-browser"], ["--dry-run"]])
def test_real_launch_never_attaches_to_a_fake_vial(home, health, no_keyboard, monkeypatch, capsys, argv):
    fake_url, claim = start_vial(health, fake=True)
    started = []
    # past this point a real launch opens the keyboard: stop there
    monkeypatch.setattr(vial_web, "run", lambda args, sock: started.append(args.fake) or 0)
    try:
        assert vial_web.main(argv) == 0
    finally:
        vial_web.release_instance(claim)
    out, err = capsys.readouterr()
    assert started == [False]
    assert fake_url not in out + err and home == []


@pytest.mark.parametrize("running, argv", [(False, ["--fake"]), (True, [])])
def test_other_modes_instance_is_never_opened_even_with_shared_files(home, health, no_keyboard, monkeypatch,
                                                                     capsys, running, argv):
    """ Second guard: should both modes ever use the same files, the mode recorded in server.json and reported by
    /api/health still keeps a launch away from the other mode's instance """
    shared = vial_web.data_dir(False)
    monkeypatch.setattr(vial_web, "data_dir", lambda fake: shared)
    monkeypatch.setattr(vial_web, "STARTUP_WAIT", 0.3)
    other_url, claim = start_vial(health, fake=running)
    try:
        assert vial_web.main(argv) == 1  # the shared lock is held: it waits for an answer of its own mode, then gives up
    finally:
        vial_web.release_instance(claim)
    out, err = capsys.readouterr()
    assert other_url not in out + err and home == []
    assert "did not answer" in err


# ---------- a launch while another one is starting up ----------

@pytest.fixture
def other_instance(home):
    """ Other Vials, fake and real, that have claimed the instance and are still connecting to the keyboard """
    claims = [vial_web.claim_instance(fake) for fake in (True, False)]
    assert None not in claims
    yield
    for claim in claims:
        vial_web.release_instance(claim)


@pytest.mark.parametrize("fake", [True, False])
def test_instance_claim_is_exclusive(home, fake):
    claim = vial_web.claim_instance(fake)
    assert claim is not None
    assert vial_web.claim_instance(fake) is None
    other_mode = vial_web.claim_instance(not fake)  # the other mode has its own
    assert other_mode is not None
    vial_web.release_instance(other_mode)
    vial_web.release_instance(claim)
    claim = vial_web.claim_instance(fake)
    assert claim is not None
    vial_web.release_instance(claim)


def test_launch_while_another_is_starting_waits_for_it(home, no_keyboard, other_instance, monkeypatch, capsys):
    answers = iter([None, None, None, LIVE_URL])
    monkeypatch.setattr(vial_web, "running_session", lambda fake: next(answers))
    waits = []
    monkeypatch.setattr(vial_web.time, "sleep", waits.append)
    assert vial_web.main(["--fake"]) == 0
    assert home == [LIVE_URL]
    assert LIVE_URL in capsys.readouterr().out
    assert len(waits) == 2  # the first check found nothing; two more while waiting, then the answer


def test_launch_gives_up_on_one_that_never_answers(home, no_keyboard, other_instance, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda fake: None)
    monkeypatch.setattr(vial_web, "STARTUP_WAIT", 0.3)
    assert vial_web.main([]) == 1
    out, err = capsys.readouterr()
    assert "did not answer within 0.3 seconds" in err
    assert "Traceback" not in err and "Open it at" not in out
    assert home == []


def test_real_dry_run_refuses_while_another_is_starting(home, no_keyboard, other_instance, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda fake: None)
    assert vial_web.main(["--dry-run"]) != 0
    assert "already running" in capsys.readouterr().err


HOLD_CLAIM = """
import sys, time, vial_web
vial_web.data_dir = lambda fake: sys.argv[1]
assert vial_web.claim_instance(True) is not None
print("claimed", flush=True)
time.sleep(0.5)
"""


def test_launch_takes_over_when_the_starting_one_exits(home, fake_server, capsys):
    """ Another Vial holds the claim, then exits (or crashes) without ever answering: start normally """
    other = subprocess.Popen([sys.executable, "-c", HOLD_CLAIM, vial_web.data_dir(True)],
                             cwd=os.path.dirname(os.path.abspath(vial_web.__file__)), stdout=subprocess.PIPE,
                             text=True)
    try:
        assert other.stdout.readline().strip() == "claimed"
        assert vial_web.claim_instance(True) is None
        assert vial_web.main(["--fake", "--no-browser"]) == 0
        assert other.poll() == 0  # it had exited; this one claimed the instance after it
    finally:
        other.kill()
        other.wait()
    out, err = capsys.readouterr()
    assert fake_server.seen["session"]["url"] in out
    assert err == ""


def test_lock_file_that_cannot_be_opened_is_a_clear_error(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda fake: None)
    for fake in (True, False):
        os.makedirs(vial_web.lock_file(fake))  # a folder where the lock file should be
    for argv in (["--fake"], ["--dry-run"]):
        assert vial_web.main(argv) == 1
        out, err = capsys.readouterr()
        assert "could not open" in err and "vial.lock" in err
        assert "Traceback" not in err and len(err.strip().splitlines()) == 1
    assert home == []


def test_release_unlocks_before_closing(home, monkeypatch):
    calls = []
    if os.name == "nt":
        import msvcrt
        locking = msvcrt.locking
        monkeypatch.setattr(msvcrt, "locking", lambda fd, mode, n: (calls.append(mode), locking(fd, mode, n)))
        unlock = msvcrt.LK_UNLCK
    else:
        import fcntl
        flock = fcntl.flock
        monkeypatch.setattr(fcntl, "flock", lambda fd, op: (calls.append(op), flock(fd, op)))
        unlock = fcntl.LOCK_UN
    close = os.close
    monkeypatch.setattr(os, "close", lambda fd: (calls.append("close"), close(fd)))
    claim = vial_web.claim_instance(True)
    calls.clear()
    vial_web.release_instance(claim)
    assert calls == [unlock, "close"]


# ---------- binding the port ----------

def test_bind_socket_listens_on_localhost_only():
    with vial_web.bind_socket(0) as sock:
        host, port = sock.getsockname()
        assert host == "127.0.0.1" and 0 < port <= 65535
        with pytest.raises(OSError):
            vial_web.bind_socket(port)


def test_busy_port_is_a_clear_error_before_anything_is_announced(home, no_keyboard, monkeypatch, capsys):
    monkeypatch.setattr(vial_web, "running_session", lambda fake: None)
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
    assert not os.path.exists(vial_web.session_file(True))


class FakeServer:
    """ Stands in for uvicorn.Server: records what main() set up by the time it starts serving """

    seen = {}
    while_serving = None

    def __init__(self, config):
        FakeServer.seen["app"] = config.app

    def run(self, sockets):
        (sock,) = sockets
        FakeServer.seen["address"] = sock.getsockname()
        with open(vial_web.session_file(True), encoding="utf-8") as inf:  # only fake launches get this far
            FakeServer.seen["session"] = json.load(inf)
        if FakeServer.while_serving:
            FakeServer.while_serving()


@pytest.fixture
def fake_server(monkeypatch):
    FakeServer.seen, FakeServer.while_serving = {}, None
    monkeypatch.setattr(uvicorn, "Server", FakeServer)
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
    assert not os.path.exists(vial_web.session_file(True))


def test_instance_is_claimed_before_connecting_and_released_at_exit(home, fake_server, monkeypatch):
    claimed_while_connecting = []
    connect = DeviceManager.connect

    def check_claim(manager, **kwargs):
        claim = vial_web.claim_instance(True)
        claimed_while_connecting.append(claim is None)
        if claim is not None:
            vial_web.release_instance(claim)
        return connect(manager, **kwargs)
    monkeypatch.setattr(DeviceManager, "connect", check_claim)
    fake_server.while_serving = lambda: claimed_while_connecting.append(vial_web.claim_instance(True) is None)
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert claimed_while_connecting == [True, True]
    claim = vial_web.claim_instance(True)
    assert claim is not None
    vial_web.release_instance(claim)


def test_fake_mode_keeps_its_own_names(home, fake_server, monkeypatch):
    from server import names
    paths = []
    store = names.NamesStore
    monkeypatch.setattr(names, "NamesStore", lambda path: paths.append(path) or store(path))
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert paths == [vial_web.names_file(True)]


def test_cleanup_keeps_another_instances_session_file(home, fake_server):
    other = {"port": 1, "url": "http://127.0.0.1:1/", "instance": "another", "fake": True}
    fake_server.while_serving = lambda: vial_web.write_session(other)
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    with open(vial_web.session_file(True), encoding="utf-8") as inf:
        assert json.load(inf) == other


def test_ctrl_c_stops_cleanly(home, fake_server):
    def interrupt():
        raise KeyboardInterrupt  # uvicorn raises Ctrl+C again after shutting down
    fake_server.while_serving = interrupt
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert not os.path.exists(vial_web.session_file(True))


@pytest.mark.parametrize("ends", ["serving", "ctrl_c"])
def test_keyboard_is_closed_when_the_server_stops(home, fake_server, monkeypatch, ends):
    opened = []

    class Device(SimulatedHidDevice):
        def __init__(self, keyboard):
            super().__init__(keyboard)
            opened.append(self)

    def stop():
        assert [d.closed for d in opened] == [False]  # open while serving
        if ends == "ctrl_c":
            raise KeyboardInterrupt  # uvicorn raises Ctrl+C again after shutting down
    monkeypatch.setattr(device_module, "SimulatedHidDevice", Device)
    fake_server.while_serving = stop
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert len(opened) == 1 and opened[0].closed


def test_server_errors_reach_the_log(home, fake_server, caplog):
    """ uvicorn's default logging keeps its messages (tracebacks of unhandled errors among them) away from vial.log """
    uvicorn.Config(None)  # uvicorn's default logging setup: console handlers of its own, not passed on to the root
    assert not logging.getLogger("uvicorn").propagate
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    with caplog.at_level(logging.ERROR):
        logging.getLogger("uvicorn.error").error("Exception in ASGI application")
    assert "Exception in ASGI application" in caplog.text
    assert logging.getLogger("uvicorn").handlers == [] and logging.getLogger("uvicorn.error").handlers == []


@pytest.fixture
def simulated(monkeypatch):
    """ The simulated keyboards that fake launches create """
    from simulator import corne
    made = []
    make = corne.make_corne
    monkeypatch.setattr(corne, "make_corne", lambda **kwargs: made.append(make(**kwargs)) or made[-1])
    return made


def test_layout_file_is_loaded_into_the_simulator(tmp_path, corne_keyboard, simulated):
    data = json.loads(corne_keyboard[1].save_layout())
    data["layout"][0][0][0] = "KC_Q"
    path = tmp_path / "good.vil"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert vial_web.main(["--fake", "--layout", str(path), "--dry-run"]) == 0
    assert simulated[0].keymap[0][0][0] == encode("KC_Q")


def test_layout_file_is_checked_before_anything_is_written(tmp_path, corne_keyboard, simulated, capsys):
    data = json.loads(corne_keyboard[1].save_layout())
    data["layout"][0][0][0] = "KC_Q"
    data["layout"][1][0][0] = "NOT_A_KEYCODE"
    path = tmp_path / "bad.vil"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert vial_web.main(["--fake", "--layout", str(path), "--dry-run"]) == 1
    err = capsys.readouterr().err
    assert "could not load the layout file {}: not a valid Vial layout file: layer 1 row 0 column 0".format(path) in err
    assert "Traceback" not in err
    assert simulated[0].keymap[0][0][0] != encode("KC_Q")  # the first key, which was fine, wasn't written either


def test_layout_file_failure_is_a_clear_error(tmp_path, capsys):
    bad = tmp_path / "bad.vil"
    bad.write_text("this is not json", encoding="utf-8")
    assert vial_web.main(["--fake", "--layout", str(bad), "--dry-run"]) == 1
    err = capsys.readouterr().err
    assert "could not load the layout file {}: not a valid Vial layout file".format(bad) in err
    assert "Traceback" not in err
    assert vial_web.main(["--fake", "--layout", str(tmp_path / "missing.vil"), "--dry-run"]) == 1
    err = capsys.readouterr().err
    assert "could not load the layout file" in err and "No such file" in err and "Traceback" not in err


# ---------- the session file ----------

def test_session_file_is_written_atomically(home, tmp_path):
    vial_web.write_session({"port": 1, "url": "u", "instance": "a", "fake": False})
    vial_web.write_session({"port": 2, "url": "v", "instance": "b", "fake": False})
    assert os.listdir(tmp_path / "data") == ["server.json"]
    with open(vial_web.session_file(False), encoding="utf-8") as inf:
        assert json.load(inf)["instance"] == "b"


@pytest.mark.skipif(os.name == "nt", reason="POSIX permissions")
def test_session_file_is_private(home, tmp_path):
    vial_web.write_session({"port": 1, "url": "u", "instance": "a", "fake": False})
    assert os.stat(tmp_path / "data").st_mode & 0o777 == 0o700
    assert os.stat(vial_web.session_file(False)).st_mode & 0o777 == 0o600


def flaky(operation, failures):
    """ operation, failing with PermissionError (a file in use, on Windows) the first failures times """
    calls = []

    def attempt(*args):
        calls.append(args)
        if len(calls) <= failures:
            raise PermissionError(13, "The process cannot access the file because it is being used by another process")
        return operation(*args)
    return attempt


@pytest.fixture
def waits(monkeypatch):
    waited = []
    monkeypatch.setattr(vial_web.time, "sleep", waited.append)
    return waited


def test_session_file_in_use_is_written_after_a_retry(home, monkeypatch, waits):
    monkeypatch.setattr(os, "replace", flaky(os.replace, 2))
    assert vial_web.write_session({"port": 1, "url": "u", "instance": "a", "fake": False})
    with open(vial_web.session_file(False), encoding="utf-8") as inf:
        assert json.load(inf)["instance"] == "a"
    assert len(waits) == 2


def test_session_file_in_use_for_long_is_logged_not_raised(home, monkeypatch, waits, caplog):
    monkeypatch.setattr(os, "replace", flaky(os.replace, 100))
    with caplog.at_level(logging.WARNING, logger="vial_web"):
        assert not vial_web.write_session({"port": 1, "url": "u", "instance": "a", "fake": False})
    assert "could not write the session file" in caplog.text
    assert os.listdir(vial_web.data_dir(False)) == []  # the temporary file isn't left behind either
    assert 0.4 <= sum(waits) <= 0.6


@pytest.mark.parametrize("failures", [2, 100])
def test_session_file_in_use_is_removed_after_a_retry(home, monkeypatch, waits, caplog, failures):
    vial_web.write_session({"port": 1, "url": "u", "instance": "a", "fake": False})
    monkeypatch.setattr(os, "remove", flaky(os.remove, failures))
    with caplog.at_level(logging.WARNING, logger="vial_web"):
        vial_web.remove_session("a", False)  # never raises
    gave_up = failures == 100
    assert os.path.exists(vial_web.session_file(False)) == gave_up
    assert ("could not remove the session file" in caplog.text) == gave_up


@pytest.mark.parametrize("fake", [True, False])
def test_cleanup_removes_only_our_session_file(home, fake):
    vial_web.write_session({"port": 1, "url": "u", "instance": "theirs", "fake": fake})
    vial_web.remove_session("ours", fake)
    vial_web.remove_session("theirs", not fake)  # the other mode's file is a different one
    assert os.path.exists(vial_web.session_file(fake))
    vial_web.remove_session("theirs", fake)
    assert not os.path.exists(vial_web.session_file(fake))
    vial_web.remove_session("theirs", fake)  # already gone: no error


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
    os.makedirs(vial_web.data_dir(False), exist_ok=True)
    with open(vial_web.session_file(False), "w", encoding="utf-8") as outf:
        outf.write(content if isinstance(content, str) else json.dumps(content))


def session_for(port, instance="abc", fake=False):
    return {"port": port, "url": "http://127.0.0.1:{}/?token=t".format(port), "instance": instance, "fake": fake}


def test_no_running_session(home):
    assert vial_web.running_session(False) is None
    write_session_file(session_for(unused_port()))
    assert vial_web.running_session(False) is None


def test_running_session_is_found(home, health):
    server = health({"app": "vial", "instance": "abc", "fake": False})
    write_session_file(session_for(server.port))
    assert vial_web.running_session(False) == session_for(server.port)["url"]


def test_running_session_ignores_http_proxies(home, health, monkeypatch):
    for name in ("http_proxy", "HTTP_PROXY"):
        monkeypatch.setenv(name, "http://127.0.0.1:{}".format(unused_port()))
    for name in ("no_proxy", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
    server = health({"app": "vial", "instance": "abc", "fake": False})
    write_session_file(session_for(server.port))
    assert vial_web.running_session(False) == session_for(server.port)["url"]


@pytest.mark.parametrize("recorded, reported", [(False, True), (True, False), (True, True), (None, False),
                                                 (False, None), (0, False), (False, 0), ("false", False)])
def test_running_session_needs_the_same_mode(home, health, monkeypatch, recorded, reported):
    """ A real launch never attaches to a fake instance, nor the reverse, whatever server.json and the health check
    say about each other (None: the field is missing) """
    shared = vial_web.data_dir(False)
    monkeypatch.setattr(vial_web, "data_dir", lambda fake: shared)  # both modes' files in one place
    body = {"app": "vial", "instance": "abc"}
    if reported is not None:
        body["fake"] = reported
    server = health(body)
    session = session_for(server.port)
    del session["fake"]
    if recorded is not None:
        session["fake"] = recorded
    write_session_file(session)
    for fake in (True, False):
        if recorded is fake and reported is fake:
            assert vial_web.running_session(fake) == session["url"]
        else:
            assert vial_web.running_session(fake) is None


def test_running_session_needs_the_same_instance(home, health):
    server = health({"app": "vial", "instance": "someone else", "fake": False})
    write_session_file(session_for(server.port))
    assert vial_web.running_session(False) is None


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
    assert vial_web.running_session(False) is None


def test_url_must_point_at_the_recorded_port(home, health):
    server = health({"app": "vial", "instance": "abc", "fake": False})
    write_session_file(dict(session_for(server.port), url="http://example.com/"))
    assert vial_web.running_session(False) is None


@pytest.mark.parametrize("body", [["not", "a", "dict"], "vial", None, b"\xff\xfe garbage", b""])
def test_odd_health_replies_are_ignored(home, health, body):
    server = health(body)
    write_session_file(session_for(server.port))
    assert vial_web.running_session(False) is None


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
        assert vial_web.running_session(False) is None
    finally:
        thread.join(2)
        listener.close()


# ---------- --data-dir ----------

@pytest.fixture
def no_platform_dirs(monkeypatch):
    """ Fails the test if anything asks for the user's real data or config dir """
    def refuse(*args, **kwargs):
        raise AssertionError("used the user's own data or config dir")
    monkeypatch.setattr(vial_web.platformdirs, "user_data_dir", refuse)
    monkeypatch.setattr(vial_web.platformdirs, "user_config_dir", refuse)
    monkeypatch.setattr(vial_web.webbrowser, "open", refuse)


@pytest.fixture
def root_log_handlers():
    """ Removes (and closes) the log handlers main() adds to the root logger """
    root = logging.getLogger()
    level, before = root.level, list(root.handlers)
    yield
    root.setLevel(level)
    for handler in [h for h in root.handlers if h not in before]:
        root.removeHandler(handler)
        handler.close()


def test_data_dir_option_is_made_absolute(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert vial_web.parse_args(["--fake", "--data-dir", "here"]).data_dir == str(tmp_path / "here")
    assert vial_web.parse_args(["--fake"]).data_dir is None


@pytest.mark.parametrize("fake", [True, False])
def test_data_dir_holds_every_file_of_its_mode(tmp_path, no_platform_dirs, fake):
    vial_web.use_data_dir(str(tmp_path))
    where = str(tmp_path / "fake") if fake else str(tmp_path)
    for path in (vial_web.lock_file, vial_web.session_file, vial_web.log_file, vial_web.names_file):
        assert os.path.dirname(path(fake)) == where


def test_fake_launch_with_data_dir_keeps_everything_in_it(tmp_path, no_platform_dirs, fake_server, monkeypatch,
                                                          root_log_handlers):
    from server import names
    paths = []
    store = names.NamesStore
    monkeypatch.setattr(names, "NamesStore", lambda path: paths.append(path) or store(path))
    assert vial_web.main(["--fake", "--no-browser", "--data-dir", str(tmp_path)]) == 0
    fake_dir = tmp_path / "fake"
    assert paths == [str(fake_dir / "names.json")]
    assert fake_server.seen["session"]["fake"] is True  # server.json was found in the fake subfolder while serving
    assert sorted(os.listdir(tmp_path)) == ["fake"]
    assert "vial.lock" in os.listdir(fake_dir) and "vial.log" in os.listdir(fake_dir)


def test_launch_without_data_dir_uses_the_user_dirs_again(tmp_path, home, fake_server):
    vial_web.use_data_dir(str(tmp_path / "elsewhere"))
    assert vial_web.main(["--fake", "--no-browser"]) == 0
    assert vial_web.data_dir(True) != str(tmp_path / "elsewhere" / "fake")
    assert not os.path.exists(tmp_path / "elsewhere")
