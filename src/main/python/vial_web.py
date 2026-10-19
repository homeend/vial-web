# SPDX-License-Identifier: GPL-2.0-or-later
""" Starts Vial's local web server and opens the browser.

    python vial_web.py            # real keyboards (hidapi)
    python vial_web.py --fake     # simulated keyboard, never touches hardware
"""
import argparse
import json
import logging
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler

import platformdirs

APP_NAME = "Vial"
FAKE_SUBDIR = "fake"
""" Fake mode keeps its own instance lock, server.json, vial.log and names.json in this subfolder of the data and
config dirs. So a fake launch never finds, waits for or opens a real Vial (which uses the real keyboard), and a real
launch never opens the simulator. server.json and /api/health also say which mode an instance runs in, and only an
instance of the same mode is ever attached to, even if the files were somehow shared. """
HEALTH_REPLY_LIMIT = 64 * 1024
""" bytes read from whatever answers the health check """
STARTUP_WAIT = 10.0
""" seconds a second launch waits for a Vial that is still starting up to answer """
FILE_RETRIES = 6
FILE_RETRY_WAIT = 0.1
""" server.json in use by another process: tries, and seconds between them """
MAX_FAKE_LAYERS = 32
""" --layers: Vial keyboards have at most 32 layers, as many as MO, TG, DF and OSL can name (LT, LM and protocol 5's
TO only reach the first 16) """
MAX_UNLOCK_COUNTER = 255
LIGHTING_KINDS = ("none", "qmk_backlight", "qmk_rgblight", "qmk_backlight_rgblight", "vialrgb")
""" --lighting: what vial.json's "lighting" can say (simulator.corne.LIGHTING; not imported, as a real launch never
loads the simulator) """
""" --unlock-counter: the firmware's VIAL_UNLOCK_COUNTER_MAX fits in one byte of the unlock poll's reply """
UVICORN_LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    # no handlers of uvicorn's own: its messages, such as tracebacks of unhandled errors, go to vial.log
    "loggers": {name: {"handlers": [], "propagate": True} for name in ("uvicorn", "uvicorn.error", "uvicorn.access")},
}

STARTED_MESSAGE = """Vial is running{fake}. Open it at:
  {url}
Press Ctrl+C to stop."""

REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
  {url}
Press Ctrl+C to stop."""

log = logging.getLogger(__name__)

_data_root = None
""" --data-dir: one folder holding the lock, server.json, vial.log and names.json instead of the user's data and
config dirs (fake mode still uses its own subfolder of it). None: the user's dirs. """


def use_data_dir(path):
    """ Keep every file in path (None: the user's data and config dirs) """
    global _data_root
    _data_root = path


def _mode_dir(path, fake):
    return os.path.join(path, FAKE_SUBDIR) if fake else path


def data_dir(fake):
    """ Holds the instance lock, server.json and vial.log of real mode, or (fake=True) of fake mode """
    return _mode_dir(_data_root or platformdirs.user_data_dir(APP_NAME, appauthor=False), fake)


def config_dir(fake):
    """ Holds names.json of real mode, or (fake=True) of fake mode """
    return _mode_dir(_data_root or platformdirs.user_config_dir(APP_NAME, appauthor=False), fake)


def lock_file(fake):
    return os.path.join(data_dir(fake), "vial.lock")


def session_file(fake):
    return os.path.join(data_dir(fake), "server.json")


def log_file(fake):
    return os.path.join(data_dir(fake), "vial.log")


def names_file(fake):
    return os.path.join(config_dir(fake), "names.json")


def ensure_data_dir(fake):
    """ The data dir, created if needed. It holds the session token (server.json), so only the user may open it. """
    path = data_dir(fake)
    os.makedirs(path, mode=0o700, exist_ok=True)
    if os.name != "nt":  # on Windows the per-user %LOCALAPPDATA% already is private
        os.chmod(path, 0o700)
    return path


def setup_logging(fake):
    ensure_data_dir(fake)
    handler = RotatingFileHandler(log_file(fake), maxBytes=5 * 1024 * 1024, backupCount=5, delay=True)
    handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def bind_socket(port):
    """ A socket listening on 127.0.0.1:port (0 for any free port). Raises OSError if the port can't be used. """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            # Windows: no other program may bind the same port while Vial uses it
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            # POSIX: a restart may reuse the port while old connections are in TIME_WAIT
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", port))
        sock.listen(128)
    except BaseException:
        sock.close()
        raise
    return sock


def retry_while_in_use(operation, *args):
    """ operation(*args), tried again for about half a second while it fails with PermissionError: on Windows,
    server.json can't be replaced or deleted while another launch has it open to look for this instance """
    for attempt in range(FILE_RETRIES):
        try:
            return operation(*args)
        except PermissionError:
            if attempt == FILE_RETRIES - 1:
                raise
            time.sleep(FILE_RETRY_WAIT)


def write_session(info):
    """ Write server.json (of the mode info["fake"] names) atomically, readable by the user only (it holds the
    session token). Returns whether that worked: if not, a later launch can't find this instance, which is logged
    but doesn't stop this one. """
    fake = info["fake"]
    temp = None
    try:
        fd, temp = tempfile.mkstemp(prefix="server.", suffix=".tmp", dir=ensure_data_dir(fake))  # mode 0o600
        with os.fdopen(fd, "w", encoding="utf-8") as outf:
            json.dump(info, outf)
        retry_while_in_use(os.replace, temp, session_file(fake))
        return True
    except BaseException as e:
        if temp is not None:
            try:
                os.remove(temp)
            except OSError:
                pass
        if not isinstance(e, OSError):
            raise
        log.warning("could not write the session file %s: %s", session_file(fake), e)
        return False


def remove_session(instance, fake):
    """ Delete server.json, unless another instance has written its own since """
    try:
        with open(session_file(fake), "r", encoding="utf-8") as inf:
            info = json.load(inf)
        if isinstance(info, dict) and info.get("instance") == instance:
            retry_while_in_use(os.remove, session_file(fake))
    except FileNotFoundError:
        pass
    except Exception as e:
        log.warning("could not remove the session file %s: %s", session_file(fake), e)


def running_session(fake):
    """ The URL of an already running Vial server of the same mode (fake or real), or None. Never raises. """
    fake = bool(fake)
    try:
        with open(session_file(fake), "r", encoding="utf-8") as inf:
            info = json.load(inf)
        if not isinstance(info, dict):
            return None
        port, url, instance = info.get("port"), info.get("url"), info.get("instance")
        if type(port) is not int or not 0 < port <= 65535 or not isinstance(instance, str) \
                or not isinstance(url, str) or not url.startswith("http://127.0.0.1:{}/".format(port)):
            return None
        if info.get("fake") is not fake:
            return None  # the other mode's: a fake launch must never open the real keyboard's Vial, nor the reverse
        # straight to this computer, never through an HTTP proxy
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:{}/api/health".format(port), timeout=1) as resp:
            health = json.loads(resp.read(HEALTH_REPLY_LIMIT))
        if isinstance(health, dict) and health.get("app") == "vial" and health.get("instance") == instance \
                and health.get("fake") is fake:
            return url
    except Exception as e:
        # no file, a stale or garbled one, nothing (or something else) on that port
        log.debug("no running Vial server: %s", e)
    return None


class InstanceLockError(Exception):
    """ The lock file can't be opened at all (as opposed to being held by another Vial) """


def claim_instance(fake):
    """ Take the instance lock of this mode (fake or real), held until release_instance() or the end of the process.
    Returns None if another Vial of this mode holds it: that one is starting up or running, and owns the keyboard.
    Raises InstanceLockError if the lock file can't be opened. """
    path = lock_file(fake)
    try:
        ensure_data_dir(fake)
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError as e:
        raise InstanceLockError("could not open {}: {}".format(path, e.strerror or e)) from e
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    except BaseException:
        os.close(fd)
        raise
    return fd


def release_instance(claim):
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(claim, msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(claim, fcntl.LOCK_UN)
    finally:
        os.close(claim)  # closing the file would release the lock too


def wait_for_other_instance(timeout, fake):
    """ While another Vial of this mode holds the claim: (its URL, None) once it answers; (None, claim) if it exits
    and this process gets the claim; (None, None) after timeout seconds """
    deadline = time.monotonic() + timeout
    while True:
        url = running_session(fake)
        if url:
            return url, None
        claim = claim_instance(fake)
        if claim is not None:
            return None, claim
        if time.monotonic() >= deadline:
            return None, None
        time.sleep(0.25)


def open_running(url, args):
    print("Vial is already running{}. Open it at:\n  {}".format(" with a simulated keyboard" if args.fake else "", url),
          flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    return 0


def make_backend(args):
    if args.fake:
        from server.device import FakeBackend
        from simulator.virtual_keyboard import FIRMWARE_UNLOCK_POLL_GAP
        layers = {} if args.layers is None else {"layers": args.layers}  # else the simulator's own default

        def firmware_timed(vk):
            # unlocks with the real firmware's timing (polls too soon after the last start the countdown over); the
            # simulator's default, counting down on every poll, is for tests
            vk.unlock_poll_gap = FIRMWARE_UNLOCK_POLL_GAP
            if args.unlock_counter is not None:
                vk.unlock_counter_max = args.unlock_counter
            return vk
        if args.definition:
            from simulator.virtual_keyboard import VirtualKeyboard
            with open(args.definition, "r", encoding="utf-8") as inf:
                definition = json.load(inf)
            if args.lighting is not None:
                definition["lighting"] = args.lighting
            return FakeBackend(lambda: firmware_timed(VirtualKeyboard(definition, **layers)))
        from simulator.corne import make_corne
        lighting = {} if args.lighting is None else {"lighting": args.lighting}
        return FakeBackend(lambda: firmware_timed(make_corne(**layers, **lighting)))
    from server.device import HidBackend
    return HidBackend()


def layer_count(text):
    try:
        count = int(text)
    except ValueError:
        count = 0
    if not 1 <= count <= MAX_FAKE_LAYERS:
        raise argparse.ArgumentTypeError("{!r} is not a layer count (1 to {})".format(text, MAX_FAKE_LAYERS))
    return count


def unlock_counter(text):
    try:
        counter = int(text)
    except ValueError:
        counter = 0
    if not 1 <= counter <= MAX_UNLOCK_COUNTER:
        raise argparse.ArgumentTypeError("{!r} is not an unlock countdown (1 to {})".format(text, MAX_UNLOCK_COUNTER))
    return counter


def port_number(text):
    try:
        port = int(text)
    except ValueError:
        port = -1
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError("{!r} is not a port number (1 to 65535, or 0 for any free port)".format(text))
    return port


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Vial keyboard configurator (web UI)")
    parser.add_argument("--fake", action="store_true", help="use a simulated keyboard instead of real hardware")
    parser.add_argument("--definition", help="with --fake: vial.json of the keyboard to simulate")
    parser.add_argument("--layout", help="with --fake: .vil layout file to load into the simulated keyboard")
    parser.add_argument("--layers", type=layer_count,
                        help="with --fake: how many layers the simulated keyboard has (1 to {}; default: the "
                             "simulator's own, 4 for the sample Corne)".format(MAX_FAKE_LAYERS))
    parser.add_argument("--unlock-counter", type=unlock_counter,
                        help="with --fake: how many polls the unlock keys must be held for, about 0.2 s each (1 to "
                             "{}; default: the firmware's 50, about 10 s)".format(MAX_UNLOCK_COUNTER))
    parser.add_argument("--lighting", choices=LIGHTING_KINDS,
                        help="with --fake: the lighting the simulated keyboard has (default: what its definition says; "
                             "VialRGB for the sample Corne)")
    parser.add_argument("--port", type=port_number, default=0, help="port to listen on (default: any free port)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
    parser.add_argument("--data-dir", type=os.path.abspath,
                        help="keep the instance lock, session file, log and names in this folder instead of the "
                             "user's data and config folders (for tests and development)")
    args = parser.parse_args(argv)
    if (args.definition or args.layout or args.layers or args.unlock_counter or args.lighting) and not args.fake:
        parser.error("--definition, --layout, --layers, --unlock-counter and --lighting only work with --fake")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    use_data_dir(args.data_dir)

    # Claim the instance before touching any keyboard: a second instance opening the keyboard and reading
    # everything from it would mix up the replies the first one is waiting for. The claim is held from before
    # connecting (a full read of the keyboard) until exit, so it also covers a Vial that is still starting up.
    claim = sock = None
    try:
        if args.dry_run:
            if not args.fake:
                claim = claim_instance(False)
                if claim is None or running_session(False):
                    print("Vial is already running and using the keyboard; stop it before using --dry-run",
                          file=sys.stderr)
                    return 1
        else:
            # everything below looks only at instances of the same mode (fake or real): see FAKE_SUBDIR
            setup_logging(args.fake)
            existing = running_session(args.fake)
            if existing:
                return open_running(existing, args)
            claim = claim_instance(args.fake)
            if claim is None:
                # another Vial is starting up: it answers once it has read the keyboard (or exits)
                existing, claim = wait_for_other_instance(STARTUP_WAIT, args.fake)
                if existing:
                    return open_running(existing, args)
            if claim is None:
                print("Another Vial is starting up but did not answer within {:g} seconds. Try again in a moment, "
                      "or stop the other one first.".format(STARTUP_WAIT), file=sys.stderr)
                return 1
            try:
                sock = bind_socket(args.port)
            except OSError as e:
                print("Vial could not listen on {}: {}".format(
                    "port {}".format(args.port) if args.port else "a free port", e.strerror or e), file=sys.stderr)
                return 1
        return run(args, sock)
    except InstanceLockError as e:
        print("Vial {}".format(e), file=sys.stderr)
        return 1
    finally:
        if sock is not None:
            sock.close()
        if claim is not None:
            release_instance(claim)


def run(args, sock):
    from protocol.unlock_hook import set_unlock_handler
    from server import model
    from server.device import SAFE_UNLOCK_POLL_GAP, DeviceManager, require_unlocked

    set_unlock_handler(require_unlocked)
    try:
        backend = make_backend(args)
    except Exception as e:
        print("could not load the keyboard definition {}: {}".format(args.definition, e), file=sys.stderr)
        return 1
    manager = DeviceManager(backend, unlock_poll_gap=SAFE_UNLOCK_POLL_GAP)
    try:
        # a dry run leaves a keyboard waiting for an unlock started earlier as it is: unlock_start would start its
        # countdown over
        manager.connect(resume_unlock=not args.dry_run)
        if args.layout:
            error = load_layout_file(manager, args.layout)
            if error:
                print("could not load the layout file {}: {}".format(args.layout, error), file=sys.stderr)
                return 1

        if args.dry_run:
            status = manager.status()
            if not status.connected and manager.unlock_state().state != "locked":
                # found, but it answers nothing else until its unlock keys are held
                print("keyboard found: {}, waiting for its unlock keys (an unlock started earlier); it can't be read "
                      "until they are held: run without --dry-run to unlock it".format(status.title))
                return 1
            if not status.connected:
                print("no keyboard found" + (": " + status.error if status.error else ""))
                return 1
            summary = manager.run(lambda kb: model.build(kb, {"layers": {}, "tapDance": {}, "macros": {}},
                                                         manager.unlocked))
            print(json.dumps({"device": status.title, "name": summary.name, "layers": len(summary.layers),
                              "keys": len(summary.keys), "fake": manager.backend.fake}))
            return 0
        return serve(args, manager, sock)
    finally:
        manager.close()  # stopped (Ctrl+C included): let go of the keyboard


def load_layout_file(manager, path):
    """ Write a .vil file to the keyboard, checked as a whole first like an upload through the API: nothing is written
    if it doesn't fit the keyboard. Returns None, or why it failed. """
    from server import edits
    if not manager.backend.fake:
        raise RuntimeError("a layout file for any keyboard is loaded into the simulator only")  # any_keyboard below
    try:
        with open(path, "rb") as inf:
            data = inf.read()
    except OSError as e:
        return e.strerror or str(e)
    try:
        # any keyboard's: the simulated one stands in for the keyboard that saved the file
        manager.run(lambda kb: edits.prepare_layout_file(kb, data, any_keyboard=True)())
    except Exception as e:
        return str(e) or e.__class__.__name__
    return None


def serve(args, manager, sock):
    """ Serve the UI on the bound socket until Ctrl+C """
    import uvicorn
    from server.app import create_app
    from server.names import NamesStore

    port = sock.getsockname()[1]
    token = secrets.token_urlsafe(24)
    instance = secrets.token_hex(8)
    url = "http://127.0.0.1:{}/?token={}".format(port, token)
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "web", "dist")
    names = NamesStore(names_file(args.fake))

    def all_tabs_closed():
        print(REOPEN_MESSAGE.format(url=url), flush=True)
        logging.info("all browser tabs closed")

    app = create_app(manager, names, token, port, static_dir=static_dir, on_all_clients_gone=all_tabs_closed,
                     instance_id=instance)

    write_session({"port": port, "url": url, "instance": instance, "fake": bool(args.fake)})
    try:
        # the socket is already listening: the URL works from now on
        print(STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard" if args.fake else ""), flush=True)
        logging.info("serving on port %d", port)
        if not args.no_browser:
            threading.Thread(target=webbrowser.open, args=[url], daemon=True).start()
        uvicorn.Server(uvicorn.Config(app, log_level="warning", log_config=UVICORN_LOGGING)).run(sockets=[sock])
    except KeyboardInterrupt:
        pass  # uvicorn shuts down cleanly on Ctrl+C, then raises it again
    finally:
        remove_session(instance, bool(args.fake))
    return 0


if __name__ == "__main__":
    sys.exit(main())
