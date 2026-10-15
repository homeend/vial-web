# SPDX-License-Identifier: GPL-2.0-or-later
""" Writes the API's OpenAPI schema, which the web UI's TypeScript types are generated from.

    python -m server.dump_openapi OUT.json     (from src/main/python)

Builds the app around a simulated keyboard that is never connected: no server, no device, no files but OUT.json.
"""
import json
import os
import sys

from server.app import create_app
from server.device import DeviceManager, FakeBackend
from server.names import NamesStore
from simulator.corne import make_corne


def schema():
    app = create_app(DeviceManager(FakeBackend(make_corne)), NamesStore(os.devnull), token="unused", port=0,
                     poll_interval=0)
    return app.openapi()


USAGE = "usage: python -m server.dump_openapi OUT.json"


def main(argv):
    if len(argv) == 1 and argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0
    if len(argv) != 1 or argv[0].startswith("-"):
        print(USAGE, file=sys.stderr)
        return 2
    text = json.dumps(schema(), indent=2, ensure_ascii=False) + "\n"  # complete before the file is touched
    with open(argv[0], "w", encoding="utf-8", newline="\n") as outf:
        outf.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
