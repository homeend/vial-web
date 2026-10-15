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

    def _load(self, for_write=False):
        """ Stored names, normalised to {uid: {kind: {index: name}}}. Reading for display treats any unreadable
        file as empty; reading for write only treats a missing file as empty, moves an unparsable one aside to
        <path>.corrupt and lets other I/O errors propagate, so a failed read never leads to wiping the names. """
        try:
            with open(self.path, "r", encoding="utf-8") as inf:
                data = json.load(inf)
        except FileNotFoundError:
            return {}
        except ValueError:
            if for_write:
                os.replace(self.path, self.path + ".corrupt")
            return {}
        except OSError:
            if for_write:
                raise
            return {}
        clean = {}
        if isinstance(data, dict):
            for uid, entry in data.items():
                if isinstance(entry, dict):
                    clean[uid] = {kind: {str(k): v for k, v in names.items() if isinstance(v, str)}
                                  for kind, names in entry.items() if isinstance(names, dict)}
        return clean

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
            data = self._load(for_write=True)
            entry = data.setdefault(uid, {}).setdefault(kind, {})
            name = (name or "").strip()[:40].strip()
            if name:
                entry[str(index)] = name
            else:
                entry.pop(str(index), None)
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            tmp = self.path + ".tmp"
            try:
                with open(tmp, "w", encoding="utf-8") as outf:
                    json.dump(data, outf, indent=2, ensure_ascii=False)
                    outf.flush()
                    os.fsync(outf.fileno())
                os.replace(tmp, self.path)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
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
