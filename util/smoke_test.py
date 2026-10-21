# SPDX-License-Identifier: GPL-2.0-or-later
""" Smoke test of a Vial build: it starts, serves its simulated keyboard, and quits through the page's API.

    python util/smoke_test.py dist/Vial.exe        (or dist/vial; any command that runs Vial)

Vial runs with --fake (the simulated keyboard: no keyboard is looked for or opened), --no-browser and a temporary
--data-dir. It checks `--self-check`, then waits for the link Vial prints, reads GET /api/session (a connected
simulated keyboard), quits with POST /api/shutdown, and checks that Vial exits with 0 by itself. Prints how long it
took to start. Python's standard library only. Exits 1 on any failure, and stops whatever it started first.
"""
import http.cookiejar
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

START_TIMEOUT = 60
EXIT_TIMEOUT = 20
STOP_WAIT = 5
""" seconds stop() gives Vial at each step before it takes the next, harder one """
LINK = re.compile(r"Open it at:\r?\n\s*(http://127\.0\.0\.1:(\d+)/\?token=[\w-]+)\r?\n")
WINDOWS = sys.platform == "win32"


def fail(message, output=""):
    print("smoke test FAILED: " + message, file=sys.stderr)
    if output:
        print("--- Vial's output ---\n" + output, file=sys.stderr)
    sys.exit(1)


def start(args, **kwargs):
    """ subprocess.Popen(args) in a new process group of its own. A one-file build runs as two processes, the
    bootloader and its Python child: stop() reaches both through the group, and nothing outside it. """
    if WINDOWS:
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(args, **kwargs)


def _ended(process, wait):
    try:
        process.wait(wait)
        return True
    except subprocess.TimeoutExpired:
        return False


def stop(process, shutdown=None, wait=STOP_WAIT):
    """ Stops a process started by start(), with its whole group, if it still runs. First shutdown() (POST
    /api/shutdown, once Vial's link is known); then Ctrl+Break (Windows) or SIGTERM to its group only, which Vial takes
    as a clean stop; each is given `wait` seconds. Then the group is killed. """
    if process.poll() is not None:
        return
    if shutdown is not None:
        try:
            shutdown()
        except OSError:
            pass  # no answer: on to the next step at once
        else:
            if _ended(process, wait):
                return
    try:
        if WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)  # to its group: it leads one of its own
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except OSError:
        pass  # no console to send Ctrl+Break through, or the group has just ended
    else:
        if _ended(process, wait):
            return
    if WINDOWS:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
    process.wait()


def fetch(opener, request, output):
    """ opener.open(request): (its status, its body). Fails with Vial's output (a list of lines) on an HTTP error or no
    answer. """
    try:
        with opener.open(request, timeout=10) as response:
            return response.status, response.read()
    except OSError as e:  # urllib.error.HTTPError and URLError, and a timeout, are all OSErrors
        url = request if isinstance(request, str) else request.full_url
        fail("{} failed: {}".format(url, e), "".join(output))


def self_check(command, timeout=START_TIMEOUT, wait=STOP_WAIT):
    check = start(command + ["--self-check"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                  encoding="utf-8", errors="replace")
    try:
        out, err = check.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop(check, wait=wait)
        out, err = check.communicate()
        fail("--self-check did not finish within {} s; it was stopped".format(timeout), out + err)
    if check.returncode != 0:
        fail("--self-check exited with {}".format(check.returncode), out + err)
    print(out.strip())


def main(command):
    self_check(command)
    data_dir = tempfile.mkdtemp(prefix="vial-smoke-")
    started = time.monotonic()
    vial = start(command + ["--fake", "--no-browser", "--data-dir", data_dir],
                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    output = []
    shutdown = None

    def read():
        for line in vial.stdout:
            output.append(line)
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    try:
        while True:
            found = LINK.search("".join(output))
            if found:
                break
            if vial.poll() is not None:
                fail("Vial exited ({}) before serving".format(vial.returncode), "".join(output))
            if time.monotonic() - started > START_TIMEOUT:
                fail("Vial did not serve within {} s".format(START_TIMEOUT), "".join(output))
            time.sleep(0.02)
        startup = time.monotonic() - started
        link, port = found.group(1), found.group(2)
        base = "http://127.0.0.1:{}".format(port)
        # the link sets the session cookie; straight to this computer, never through a proxy
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                             urllib.request.ProxyHandler({}))
        quit_request = urllib.request.Request(base + "/api/shutdown", method="POST", headers={"Origin": base})

        def shutdown():
            opener.open(quit_request, timeout=10).close()
        fetch(opener, link, output)
        session = json.loads(fetch(opener, base + "/api/session", output)[1])
        if session.get("fake") is not True or session.get("status") != "connected":
            fail("unexpected session: {}".format(session), "".join(output))
        status = fetch(opener, quit_request, output)[0]
        if status != 204:
            fail("POST /api/shutdown answered {}".format(status), "".join(output))
        try:
            code = vial.wait(EXIT_TIMEOUT)
        except subprocess.TimeoutExpired:
            fail("Vial did not exit within {} s of POST /api/shutdown".format(EXIT_TIMEOUT), "".join(output))
        reader.join(5)
        if code != 0:
            fail("Vial exited with {}".format(code), "".join(output))
        print("smoke test passed: started in {:.2f} s, served {} ({}), quit with POST /api/shutdown, exit code 0"
              .format(startup, session.get("device"), session.get("platform")))
    finally:
        stop(vial, shutdown)  # only if it still runs: after a failure, or when stopped from outside (Ctrl+C)
        shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    program = sys.argv[1]
    # a path to the executable, as Windows takes it too (it doesn't run "dist/Vial.exe" from the current folder)
    main([os.path.abspath(program) if os.path.isfile(program) else program] + sys.argv[2:])
