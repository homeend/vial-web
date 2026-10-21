# SPDX-License-Identifier: GPL-2.0-or-later
""" Smoke test of a Vial build: it starts, serves its simulated keyboard, and quits through the page's API.

    python util/smoke_test.py dist/Vial.exe        (or dist/vial; any command that runs Vial)

Vial runs with --fake (the simulated keyboard: no keyboard is looked for or opened), --no-browser and a temporary
--data-dir. It checks `--self-check`, then waits for the link Vial prints, reads GET /api/session (a connected
simulated keyboard), quits with POST /api/shutdown, and checks that Vial exits with 0 by itself. Prints how long it
took to start. Python's standard library only. Exits 1 on any failure.
"""
import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

START_TIMEOUT = 60
EXIT_TIMEOUT = 20
LINK = re.compile(r"Open it at:\r?\n\s*(http://127\.0\.0\.1:(\d+)/\?token=[\w-]+)\r?\n")


def fail(message, output=""):
    print("smoke test FAILED: " + message, file=sys.stderr)
    if output:
        print("--- Vial's output ---\n" + output, file=sys.stderr)
    sys.exit(1)


def self_check(command):
    result = subprocess.run(command + ["--self-check"], capture_output=True, text=True, timeout=START_TIMEOUT)
    if result.returncode != 0:
        fail("--self-check exited with {}".format(result.returncode), result.stdout + result.stderr)
    print(result.stdout.strip())


def main(command):
    self_check(command)
    data_dir = tempfile.mkdtemp(prefix="vial-smoke-")
    started = time.monotonic()
    vial = subprocess.Popen(command + ["--fake", "--no-browser", "--data-dir", data_dir],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    output = []

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
        opener.open(link, timeout=10).read()
        session = json.loads(opener.open(base + "/api/session", timeout=10).read())
        if session.get("fake") is not True or session.get("status") != "connected":
            fail("unexpected session: {}".format(session), "".join(output))
        quit_request = urllib.request.Request(base + "/api/shutdown", method="POST", headers={"Origin": base})
        status = opener.open(quit_request, timeout=10).status
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
        if vial.poll() is None:
            vial.kill()
            vial.wait()
        shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    program = sys.argv[1]
    # a path to the executable, as Windows takes it too (it doesn't run "dist/Vial.exe" from the current folder)
    main([os.path.abspath(program) if os.path.isfile(program) else program] + sys.argv[2:])
