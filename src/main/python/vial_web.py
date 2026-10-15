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
import threading
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler

import platformdirs

APP_NAME = "Vial"

STARTED_MESSAGE = """Vial is running{fake}. Open it at:
  {url}
Press Ctrl+C to stop."""

REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
  {url}
Press Ctrl+C to stop."""


def data_dir():
    return platformdirs.user_data_dir(APP_NAME, appauthor=False)


def setup_logging():
    os.makedirs(data_dir(), exist_ok=True)
    handler = RotatingFileHandler(os.path.join(data_dir(), "vial.log"), maxBytes=5 * 1024 * 1024, backupCount=5)
    handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def session_file():
    return os.path.join(data_dir(), "server.json")


def running_session():
    """ The URL of an already running Vial server, or None """
    try:
        with open(session_file(), "r") as inf:
            info = json.load(inf)
        with urllib.request.urlopen("http://127.0.0.1:{}/api/health".format(info["port"]), timeout=1) as resp:
            health = json.load(resp)
        if health.get("app") == "vial" and health.get("instance") == info["instance"]:
            return info["url"]
    except (OSError, ValueError, KeyError):
        pass
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


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Vial keyboard configurator (web UI)")
    parser.add_argument("--fake", action="store_true", help="use a simulated keyboard instead of real hardware")
    parser.add_argument("--definition", help="with --fake: vial.json of the keyboard to simulate")
    parser.add_argument("--layout", help="with --fake: .vil layout file to load into the simulated keyboard")
    parser.add_argument("--port", type=int, default=0, help="port to listen on (default: any free port)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
    args = parser.parse_args(argv)
    if (args.definition or args.layout) and not args.fake:
        parser.error("--definition and --layout only work with --fake")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)

    from protocol.unlock_hook import set_unlock_handler
    from server import model
    from server.app import create_app
    from server.device import DeviceManager, require_unlocked
    from server.names import NamesStore

    set_unlock_handler(require_unlocked)
    manager = DeviceManager(make_backend(args))
    manager.connect()
    if args.layout:
        with open(args.layout, "rb") as inf:
            data = inf.read()
        manager.run(lambda kb: kb.restore_layout(data))

    if args.dry_run:
        if not manager.connected:
            print("no keyboard found" + (": " + manager.error if manager.error else ""))
            return 1
        summary = manager.run(lambda kb: model.build(kb, {"layers": {}, "tapDance": {}, "macros": {}}, manager.unlocked))
        print(json.dumps({"device": manager.title, "name": summary.name, "layers": len(summary.layers),
                          "keys": len(summary.keys), "fake": manager.backend.fake}))
        return 0

    setup_logging()
    existing = running_session()
    if existing:
        print("Vial is already running. Opening it at:\n  " + existing)
        webbrowser.open(existing)
        return 0

    import uvicorn

    port = args.port or free_port()
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

    with open(session_file(), "w") as outf:
        json.dump({"port": port, "url": url, "instance": instance}, outf)
    print(STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard" if args.fake else ""), flush=True)
    logging.info("serving on port %d", port)
    if not args.no_browser:
        threading.Timer(0.7, webbrowser.open, [url]).start()
    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    finally:
        try:
            os.remove(session_file())
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
