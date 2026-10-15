# SPDX-License-Identifier: GPL-2.0-or-later
""" User names for layers, tap dances and macros. The firmware can't store names, so they live in a JSON file,
keyed by the keyboard's UID. """
import json
import os
import threading

from server.describe import one_line

KINDS = ("layers", "tapDance", "macros")


class NamesStore:

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as inf:
                data = json.load(inf)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self, uid):
        """ {"layers": {"0": "base"}, "tapDance": {...}, "macros": {...}} for this keyboard """
        with self.lock:
            stored = self._load().get(uid, {})
        return {kind: dict(stored.get(kind, {})) for kind in KINDS}

    def set(self, uid, kind, index, name):
        """ Set a name; an empty or None name removes it """
        if kind not in KINDS:
            raise ValueError("unknown name kind: {}".format(kind))
        with self.lock:
            data = self._load()
            entry = data.setdefault(uid, {}).setdefault(kind, {})
            name = (name or "").strip()
            if name:
                entry[str(index)] = name[:40]
            else:
                entry.pop(str(index), None)
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as outf:
                json.dump(data, outf, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)
        return self.get(uid)


def suggest_tap_dance_name(described_slots):
    """ "Tab / Caps" from the described (tap, hold, double tap, tap-hold) slots; "" when all are empty """
    labels = []
    for slot in described_slots:
        if slot["kind"] != "none":
            label = one_line(slot["tap"]) or slot["code"]
            if label not in labels:
                labels.append(label)
    return " / ".join(labels)


def suggest_macro_name(actions):
    """ A macro's first typed text, or its first key, e.g. "git status"; "" for an empty macro """
    for action in actions:
        if action["type"] == "text" and action["text"].strip():
            return action["text"].strip()[:24]
    for action in actions:
        if action["type"] in ("tap", "down") and action["keys"]:
            return one_line(action["keys"][0]["tap"])
    return ""
