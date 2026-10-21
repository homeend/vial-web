""" util/smoke_test.py: how it stops what it started (a one-file build runs as two processes), and how it fails.
Nothing here runs Vial: the processes stopped are small Python scripts, each started in a process group of its own. """
import importlib.util
import os
import socket
import subprocess
import sys
import time

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
WINDOWS = sys.platform == "win32"


def load_smoke_test():
    spec = importlib.util.spec_from_file_location("smoke_test", os.path.join(ROOT, "util", "smoke_test.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke_test = load_smoke_test()

SCRIPT = '''
import os, signal, subprocess, sys, time
mode, pid_file = sys.argv[1], sys.argv[2]
if "ignore" in mode:  # like a process that doesn't stop when asked
    for name in ("SIGBREAK", "SIGTERM"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), signal.SIG_IGN)
if mode.startswith("tree"):  # like a one-file build: a parent that waits for its child, in the same group
    subprocess.Popen([sys.executable, __file__, mode.replace("tree", "leaf"), pid_file]).wait()
else:
    with open(pid_file + ".tmp", "w") as out:
        out.write(str(os.getpid()))
    os.replace(pid_file + ".tmp", pid_file)
    print("child output", flush=True)
    if mode.endswith("stdin"):
        sys.stdin.read()
    else:
        time.sleep(600)
'''


def has_console():
    if not WINDOWS:
        return True
    import ctypes
    processes = (ctypes.c_uint * 4)()
    return ctypes.windll.kernel32.GetConsoleProcessList(processes, 4) > 0


def alive(pid):
    if WINDOWS:
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def gone(pid, within=5):
    deadline = time.monotonic() + within
    while alive(pid):
        if time.monotonic() > deadline:
            return False
        time.sleep(0.05)
    return True


@pytest.fixture
def script(tmp_path):
    path = tmp_path / "script.py"
    path.write_text(SCRIPT, encoding="utf-8")
    return path


@pytest.fixture
def started(script, tmp_path):
    """ started(mode): (the process, started by smoke_test.start, its pid file's path); every one is killed after the
    test, if it still runs """
    processes = []

    def start(mode, **kwargs):
        pid_file = tmp_path / "{}.pid".format(len(processes))
        process = smoke_test.start([sys.executable, str(script), mode, str(pid_file)], **kwargs)
        processes.append(process)
        deadline = time.monotonic() + 30
        while not pid_file.exists():
            assert time.monotonic() < deadline, "the script didn't start"
            time.sleep(0.05)
        return process, int(pid_file.read_text())
    yield start
    for process in processes:
        smoke_test.stop(process, wait=0)


def test_stop_asks_first_and_waits_for_the_process_to_end_by_itself(started):
    process, pid = started("leaf-stdin", stdin=subprocess.PIPE)
    asked = []

    def shutdown():
        asked.append(True)
        process.stdin.close()  # the script ends once its input does
    smoke_test.stop(process, shutdown, wait=10)
    assert asked == [True]
    assert process.returncode == 0  # it ended by itself
    assert gone(pid)


@pytest.mark.skipif(not has_console(), reason="Ctrl+Break is sent through a console, and this process has none")
def test_stop_then_sends_ctrl_break_or_sigterm_to_the_group_only(started):
    process, child = started("tree")

    def refused():
        raise ConnectionRefusedError("nothing listens")
    smoke_test.stop(process, refused, wait=10)
    # ended by Ctrl+Break (STATUS_CONTROL_C_EXIT) or SIGTERM, not killed; and this process, outside the group, runs on
    assert process.returncode == (0xC000013A if WINDOWS else -15)
    assert gone(child)


def test_stop_kills_the_whole_group_when_it_ignores_being_asked(started):
    process, child = started("tree-ignore")
    smoke_test.stop(process, wait=1)
    assert process.returncode is not None
    assert gone(child)  # the child too, as a one-file build's Python process


def test_stop_of_an_ended_process_does_nothing(started):
    process, pid = started("leaf-stdin", stdin=subprocess.PIPE)
    process.stdin.close()
    process.wait(10)
    smoke_test.stop(process, lambda: pytest.fail("asked an ended process to stop"))
    assert process.returncode == 0


def test_a_self_check_that_hangs_is_stopped_and_fails_with_its_output(script, tmp_path, capsys):
    pid_file = tmp_path / "check.pid"
    with pytest.raises(SystemExit) as exited:
        smoke_test.self_check([sys.executable, str(script), "tree-ignore", str(pid_file)], timeout=5, wait=1)
    assert exited.value.code == 1
    err = capsys.readouterr().err
    assert "--self-check did not finish within 5 s" in err
    assert "child output" in err
    assert gone(int(pid_file.read_text()))


def test_an_http_error_fails_with_vials_output(capsys):
    with socket.socket() as sock:  # a port nothing listens on
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    opener = smoke_test.urllib.request.build_opener(smoke_test.urllib.request.ProxyHandler({}))
    url = "http://127.0.0.1:{}/api/session".format(port)
    with pytest.raises(SystemExit) as exited:
        smoke_test.fetch(opener, url, ["Vial said this\n"])
    assert exited.value.code == 1
    err = capsys.readouterr().err
    assert "smoke test FAILED: {} failed:".format(url) in err
    assert "Vial said this" in err
