#!/usr/bin/env python3
"""Turn the app's keyboard model (GET /api/keyboard) into a layout export for the lesson generator.

    python util/learning/export_layout.py keyboard.json [--fingers fingers.json] [-o layout-export.json]

A stand-in for the app's Learning → Fingers → Export (docs/learning/lesson-format.md section 2), and a way to export
a saved GET /api/keyboard reply by hand. The rules live in the server (src/main/python/server/learning_layout.py):
fingers come from the key positions by lesson-rules.md section 2; a fingers.json (section 2.3) overrides them.
Standard library only.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "main", "python"))

from server.learning_layout import export  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("keyboard", help="JSON from GET /api/keyboard")
    parser.add_argument("--fingers", help="fingers.json with corrections")
    parser.add_argument("-o", "--out", help="where to write the export (default: stdout)")
    args = parser.parse_args(argv)
    with open(args.keyboard, encoding="utf-8-sig") as f:
        model = json.load(f)
    fingers = None
    if args.fingers:
        with open(args.fingers, encoding="utf-8-sig") as f:
            fingers = json.load(f)
    result = export(model, fingers)
    text = json.dumps(result, indent=1, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
        letters = sorted(c["0"]["tap"] for k in result["keys"] for c in [k["chars"]]
                         if "0" in c and c["0"].get("tap", "").isalpha())
        print(f"{args.out}: {len(result['keys'])} keys, {len(result['layers'])} layers with characters, "
              f"letters on layer 0: {''.join(letters)}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
