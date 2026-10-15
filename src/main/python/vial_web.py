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
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler

import platformdirs

APP_NAME = "Vial"
HEALTH_REPLY_LIMIT = 64 * 1024
""" bytes read from whatever answers the health check """

STARTED_MESSAGE = """Vial is running{fake}. Open it at:
  {url}
Press Ctrl+C to stop."""

REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
  {url}
Press Ctrl+C to stop."""

log = logging.getLogger(__name__)


def data_dir():
    return platformdirs.user_data_dir(APP_NAME, appauthor=False)


def ensure_data_dir():
    """ The data dir, created if needed. It holds the session token (server.json), so only the user may open it. """
    path = data_dir()
    os.makedirs(path, mode=0o700, exist_ok=True)
    if os.name != "nt":  # on Windows the per-user %LOCALAPPDATA% already is private
        os.chmod(path, 0o700)
    return path


def setup_logging():
    handler = RotatingFileHandler(os.path.join(ensure_data_dir(), "vial.log"), maxBytes=5 * 1024 * 1024,
                                  backupCount=5, delay=True)
    handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])


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


def session_file():
    return os.path.join(data_dir(), "server.json")


def write_session(info):
    """ Write server.json atomically, readable by the user only (it holds the session token) """
    directory = ensure_data_dir()
    fd, temp = tempfile.mkstemp(prefix="server.", suffix=".tmp", dir=directory)  # created with mode 0o600
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as outf:
            json.dump(info, outf)
        os.replace(temp, session_file())
    except BaseException:
        try:
            os.remove(temp)
        except OSError:
            pass
        raise


def remove_session(instance):
    """ Delete server.json, unless another instance has written its own since """
    try:
        with open(session_file(), "r", encoding="utf-8") as inf:
            info = json.load(inf)
        if isinstance(info, dict) and info.get("instance") == instance:
            os.remove(session_file())
    except Exception as e:
        log.debug("could not remove the session file: %s", e)


def running_session():
    """ The URL of an already running Vial server, or None. Never raises. """
    try:
        with open(session_file(), "r", encoding="utf-8") as inf:
            info = json.load(inf)
        if not isinstance(info, dict):
            return None
        port, url, instance = info.get("port"), info.get("url"), info.get("instance")
        if type(port) is not int or not 0 < port <= 65535 or not isinstance(instance, str) \
                or not isinstance(url, str) or not url.startswith("http://127.0.0.1:{}/".format(port)):
            return None
        # straight to this computer, never through an HTTP proxy
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:{}/api/health".format(port), timeout=1) as resp:
            health = json.loads(resp.read(HEALTH_REPLY_LIMIT))
        if isinstance(health, dict) and health.get("app") == "vial" and health.get("instance") == instance:
            return url
    except Exception as e:
        # no file, a stale or garbled one, nothing (or something else) on that port
        log.debug("no running Vial server: %s", e)
    return None


def make_backend(args):
    if args.fake:
        from server.device import FakeBackend
        if args.definition:
            from simulator.virtual_keyboard import VirtualKeyboard
            with open(args.definition, "r", encoding="utf-8") as inf:
                definition = json.load(inf)
            return FakeBackend(lambda: VirtualKeyboard(definition))
        from simulator.corne import make_corne
        return FakeBackend(make_corne)
    from server.device import HidBackend
    return HidBackend()


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
    parser.add_argument("--port", type=port_number, default=0, help="port to listen on (default: any free port)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
    args = parser.parse_args(argv)
    if (args.definition or args.layout) and not args.fake:
        parser.error("--definition and --layout only work with --fake")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)

    # Look for a running Vial before touching any keyboard: a second instance opening the keyboard and reading
    # everything from it would mix up the replies the first one is waiting for.
    sock = None
    if args.dry_run:
        if not args.fake and running_session():
            print("Vial is already running and using the keyboard; stop it before using --dry-run", file=sys.stderr)
            return 1
    else:
        setup_logging()
        existing = running_session()
        if existing:
            print("Vial is already running. Open it at:\n  " + existing, flush=True)
            if not args.no_browser:
                webbrowser.open(existing)
            return 0
        try:
            sock = bind_socket(args.port)
        except OSError as e:
            print("Vial could not listen on {}: {}".format(
                "port {}".format(args.port) if args.port else "a free port", e.strerror or e), file=sys.stderr)
            return 1
    try:
        return run(args, sock)
    finally:
        if sock is not None:
            sock.close()


def run(args, sock):
    from protocol.unlock_hook import set_unlock_handler
    from server import model
    from server.device import DeviceManager, require_unlocked

    set_unlock_handler(require_unlocked)
    try:
        backend = make_backend(args)
    except Exception as e:
        print("could not load the keyboard definition {}: {}".format(args.definition, e), file=sys.stderr)
        return 1
    manager = DeviceManager(backend)
    manager.connect()
    if args.layout:
        try:
            with open(args.layout, "rb") as inf:
                data = inf.read()
            manager.run(lambda kb: kb.restore_layout(data))
        except Exception as e:
            print("could not load the layout file {}: {}".format(args.layout, str(e) or e.__class__.__name__),
                  file=sys.stderr)
            return 1

    if args.dry_run:
        status = manager.status()
        if not status.connected:
            print("no keyboard found" + (": " + status.error if status.error else ""))
            return 1
        summary = manager.run(lambda kb: model.build(kb, {"layers": {}, "tapDance": {}, "macros": {}}, manager.unlocked))
        print(json.dumps({"device": status.title, "name": summary.name, "layers": len(summary.layers),
                          "keys": len(summary.keys), "fake": manager.backend.fake}))
        return 0
    return serve(args, manager, sock)


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
    names = NamesStore(os.path.join(platformdirs.user_config_dir(APP_NAME, appauthor=False), "names.json"))

    def all_tabs_closed():
        print(REOPEN_MESSAGE.format(url=url), flush=True)
        logging.info("all browser tabs closed")

    app = create_app(manager, names, token, port, static_dir=static_dir, on_all_clients_gone=all_tabs_closed,
                     instance_id=instance)

    write_session({"port": port, "url": url, "instance": instance})
    try:
        # the socket is already listening: the URL works from now on
        print(STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard" if args.fake else ""), flush=True)
        logging.info("serving on port %d", port)
        if not args.no_browser:
            threading.Thread(target=webbrowser.open, args=[url], daemon=True).start()
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    except KeyboardInterrupt:
        pass  # uvicorn shuts down cleanly on Ctrl+C, then raises it again
    finally:
        remove_session(instance)
    return 0


if __name__ == "__main__":
    sys.exit(main())
