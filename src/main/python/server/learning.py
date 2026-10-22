# SPDX-License-Identifier: GPL-2.0-or-later
""" The Learning feature's files (docs/learning/lesson-format.md): the user's finger corrections, the layout export,
the lesson sets, progress and settings, per keyboard uid under <config dir>/learning/<uid>/. Every write is a new
file put in place of the old one (as NamesStore), every read tolerant: a missing file is empty, an unparsable one is
moved aside to <file>.corrupt when it is about to be written, and a hand-edited one is read for what is valid in it
(_clean_fingers, _clean_progress). An exercise's best attempt is its all-time best: the file's best outlives the
last ATTEMPTS_KEPT attempts, so that a pass or a star never regresses. Ids name files exactly: on a case-insensitive
file system (Windows, macOS) a set saved as mini is no set MINI (the listing is the authority for ids). """
import json
import math
import os
import re
import threading

from server import learning_check, learning_layout

FINGERS_FORMAT = "vial-web-fingers/1"
PROGRESS_FORMAT = "vial-web-progress/1"
ATTEMPTS_KEPT = 50
""" the last attempts of an exercise that are kept """
DEFAULT_SETTINGS = {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
FINGERS = ("index", "middle", "ring", "pinky", "thumb")
REACHES = ("rest", "up", "down", "inner", "outer")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
""" a lesson set's id (its file name) and a keyboard uid: a file or folder name that stays inside the store """
KEY_ID = re.compile(r"^r[0-9]+c[0-9]+$")


class NotFound(LookupError):
    """ No such lesson set, or no such exercise in it (404) """


class LessonSetInvalid(ValueError):
    """ A lesson set the checker refuses (422): its errors and warnings """

    def __init__(self, errors, warnings):
        super().__init__("the lesson set has {} error{}: {}".format(len(errors), "" if len(errors) == 1 else "s",
                                                                    errors[0]))
        self.errors = errors
        self.warnings = warnings


def _read_json(path):
    """ The JSON in path; FileNotFoundError, ValueError (not JSON) or another OSError """
    # utf-8-sig: a file saved by Windows Notepad may start with a byte order mark
    with open(path, "r", encoding="utf-8-sig") as inf:
        return json.load(inf)


def _attempt_key(attempt):
    """ The best attempt has the highest accuracy, then the highest WPM """
    return attempt["accuracy"], attempt["wpm"]


def _number(value):
    """ A finite number (JSON has no NaN or infinity; Python's json module reads them all the same) """
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _key_id(value):
    return isinstance(value, str) and KEY_ID.match(value) is not None


def _clean_attempt(attempt):
    """ An attempt as the file should hold it, or None for one that isn't """
    if not isinstance(attempt, dict) or not isinstance(attempt.get("at"), str):
        return None
    if not all(_number(attempt.get(f)) for f in ("chars", "errors", "accuracy", "wpm", "seconds")):
        return None
    return {f: attempt[f] for f in ("at", "chars", "errors", "accuracy", "wpm", "seconds")}


def _exercise_entry(attempts, best=None):
    """ An exercise's progress: the attempts kept, best the better (by _attempt_key) of the best so far and those
    attempts, so that it outlives the attempts kept; done once there is a best """
    candidates = ([best] if best else []) + attempts
    return {"done": bool(candidates), "best": max(candidates, key=_attempt_key) if candidates else None,
            "attempts": attempts}


def _clean_fingers(data):
    """ (corrections, problem) of data as fingers.json holds it: the corrections that are valid, as {"format", "keys":
    {key id: {"finger", "reach"}}, "home": [key ids]} (None when data holds neither a keys object nor a home list),
    and the first thing wrong with it (None when nothing is) """
    if not isinstance(data, dict):
        return None, "fingers must be an object"
    keys, home = data.get("keys"), data.get("home")
    problem = None
    if not isinstance(keys, dict) or not isinstance(home, list):
        problem = "fingers need \"keys\" (an object) and \"home\" (a list of key ids)"
        if not isinstance(keys, dict) and not isinstance(home, list):
            return None, problem
        keys, home = keys if isinstance(keys, dict) else {}, home if isinstance(home, list) else []
    clean, rest = {}, []
    for kid, change in keys.items():
        if not _key_id(kid):
            problem = problem or "not a key id: {!r}".format(kid)
        elif not isinstance(change, dict) or change.get("finger") not in FINGERS or change.get("reach") not in REACHES:
            problem = problem or "key {}: a finger ({}) and a reach ({}) are needed".format(
                kid, ", ".join(FINGERS), ", ".join(REACHES))
        else:
            clean[kid] = {"finger": change["finger"], "reach": change["reach"]}
    for kid in home:
        if not _key_id(kid):
            problem = problem or "not a key id in home: {!r}".format(kid)
        elif kid not in rest:
            rest.append(kid)
    return {"format": FINGERS_FORMAT, "keys": clean, "home": rest}, problem


class LearningStore:
    """ root: the learning folder; a folder per keyboard uid inside it """

    def __init__(self, root):
        self.root = root
        self.lock = threading.Lock()

    # ---------- files ----------

    def _dir(self, uid):
        if not isinstance(uid, str) or not ID.match(uid):
            raise ValueError("not a keyboard uid: {!r}".format(uid))
        return os.path.join(self.root, uid)

    @staticmethod
    def _check_set_id(set_id):
        """ NotFound for an id that can't be a lesson set's (so a path made of it never leaves its folder) """
        if not isinstance(set_id, str) or not ID.match(set_id):
            raise NotFound("no lesson set {!r}".format(set_id))

    def _set_path(self, uid, set_id):
        self._check_set_id(set_id)
        return os.path.join(self._dir(uid), "sets", set_id + ".json")

    def _progress_path(self, uid, set_id):
        self._check_set_id(set_id)
        return os.path.join(self._dir(uid), "progress", set_id + ".json")

    @staticmethod
    def _has_file(path):
        """ Whether the file exists under exactly that name: a case-insensitive file system (Windows, macOS) opens
        mini.json as MINI.json too, while the listing names the set mini """
        try:
            return os.path.basename(path) in os.listdir(os.path.dirname(path))
        except OSError:
            return False

    def _load(self, path, for_write=False):
        """ The JSON in path, or None when there is none. As NamesStore._load: reading for display treats any
        unreadable file as none; reading for write only treats a missing file as none, moves an unparsable one aside
        to <path>.corrupt and lets other I/O errors propagate, so a failed read never leads to wiping the file. """
        try:
            return _read_json(path)
        except FileNotFoundError:
            return None
        except ValueError:
            if for_write:
                os.replace(path, path + ".corrupt")
            return None
        except OSError:
            if for_write:
                raise
            return None

    def _save(self, path, data):
        """ Write the file whole: a new file put in place of the old one, so that a failure leaves the old one """
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as outf:
                json.dump(data, outf, indent=2, ensure_ascii=False)
                outf.flush()
                os.fsync(outf.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def _remove(self, path):
        """ Remove the file; False when there was none """
        try:
            os.remove(path)
        except FileNotFoundError:
            return False
        return True

    # ---------- fingers ----------

    def fingers(self, uid):
        """ The user's finger corrections (a vial-web-fingers/1 file as a dict, what is valid in it), or None when
        none are saved """
        with self.lock:
            data = self._load(os.path.join(self._dir(uid), "fingers.json"))
        if not isinstance(data, dict) or data.get("format") != FINGERS_FORMAT:
            return None
        return _clean_fingers(data)[0]

    def set_fingers(self, uid, data):
        """ Save corrections: {"keys": {key id: {"finger", "reach"}}, "home": [key ids]}; ValueError when they aren't
        that. Returns what was saved. """
        saved, problem = _clean_fingers(data)
        if problem:
            raise ValueError(problem)
        with self.lock:
            path = os.path.join(self._dir(uid), "fingers.json")
            self._load(path, for_write=True)  # an unparsable file is moved aside, not silently overwritten
            self._save(path, saved)
        return saved

    def clear_fingers(self, uid):
        """ Back to the app's proposal """
        with self.lock:
            self._remove(os.path.join(self._dir(uid), "fingers.json"))

    # ---------- the export ----------

    def export(self, uid, model_dict, language):
        """ The layout export of the keyboard (learning_layout.export) with the saved finger corrections, written to
        layout-export.json and returned """
        out = learning_layout.export(model_dict, self.fingers(uid), language)
        with self.lock:
            path = os.path.join(self._dir(uid), "layout-export.json")
            self._load(path, for_write=True)
            self._save(path, out)
        return out

    # ---------- lesson sets ----------

    def _summary(self, set_id, data, error=None):
        """ A lesson set's listing entry: what can be read from the file, the file name when the title can't """
        is_dict = isinstance(data, dict)
        title = data.get("title") if is_dict and isinstance(data.get("title"), str) and data["title"] else set_id
        language = data.get("language") if is_dict and isinstance(data.get("language"), str) else ""
        lessons = len(data["lessons"]) if is_dict and isinstance(data.get("lessons"), list) else 0
        layout = data.get("layout") if is_dict else None
        layout_hash = layout.get("hash") if isinstance(layout, dict) and isinstance(layout.get("hash"), str) else None
        return {"id": set_id, "title": title, "language": language, "lessons": lessons, "layoutHash": layout_hash,
                "error": error}

    def _read_set(self, set_id, path):
        """ (data, error) of a lesson set file: the first thing wrong with it, or None """
        try:
            data = _read_json(path)
        except FileNotFoundError:
            raise NotFound("no lesson set {!r}".format(set_id))
        except ValueError as e:
            return None, "not a JSON file: {}".format(e)
        errors, _ = learning_check.check_set(data)
        if errors:
            return data, errors[0]
        if data["id"] != set_id:
            return data, "id: {!r} isn't the file name".format(data["id"])
        return data, None

    def sets(self, uid):
        """ The keyboard's lesson sets, by file name: [{id, title, language, lessons, layoutHash, error}]; a file that
        isn't a lesson set is listed with what is wrong with it (error) """
        folder = os.path.join(self._dir(uid), "sets")
        with self.lock:
            try:
                names = sorted(n for n in os.listdir(folder) if n.endswith(".json"))
            except FileNotFoundError:
                return []
            out = []
            for name in names:
                set_id = name[:-len(".json")]
                if not ID.match(set_id):
                    out.append(self._summary(set_id, None, "file name: letters, digits, - and _ only"))
                    continue
                try:
                    data, error = self._read_set(set_id, os.path.join(folder, name))
                except (NotFound, OSError) as e:
                    data, error = None, "can't be read: {}".format(e)
                out.append(self._summary(set_id, data, error))
        return out

    def _read_set_named(self, uid, set_id):
        """ _read_set of the set named exactly set_id; NotFound when there is none """
        path = self._set_path(uid, set_id)
        if not self._has_file(path):
            raise NotFound("no lesson set {!r}".format(set_id))
        return self._read_set(set_id, path)

    def set(self, uid, set_id):
        """ The lesson set, whole; NotFound when there is none, ValueError when the file isn't a lesson set """
        with self.lock:
            data, error = self._read_set_named(uid, set_id)
        if error:
            raise ValueError("lesson set {}: {}".format(set_id, error))
        return data

    def import_set(self, uid, data, export=None):
        """ Check a lesson set (the parsed file) and save it as sets/<its id>.json; LessonSetInvalid when the checker
        finds errors. The export, when given, checks its new keys. Returns its listing entry with the warnings. """
        errors, warnings = learning_check.check_set(data, export)
        if errors:
            raise LessonSetInvalid(errors, warnings)
        set_id = data["id"]  # check_set saw to it being a plain id
        with self.lock:
            path = self._set_path(uid, set_id)
            self._load(path, for_write=True)
            self._save(path, data)
        return {**self._summary(set_id, data), "warnings": warnings}

    def delete_set(self, uid, set_id):
        """ Remove the lesson set; its progress file stays (a set imported again under the id finds it). NotFound
        when there is none. """
        with self.lock:
            path = self._set_path(uid, set_id)
            if not self._has_file(path) or not self._remove(path):
                raise NotFound("no lesson set {!r}".format(set_id))

    # ---------- progress ----------

    def _clean_progress(self, set_id, data):
        """ The progress file's content as vial-web-progress/1, whatever it holds: each exercise's last ATTEMPTS_KEPT
        attempts that are attempts, its best the better of the file's best (when that is an attempt: it is the
        all-time best, kept when the attempt itself is gone) and of those, done once there is a best """
        exercises = {}
        if isinstance(data, dict) and isinstance(data.get("exercises"), dict):
            for eid, entry in data["exercises"].items():
                if not isinstance(eid, str) or not isinstance(entry, dict):
                    continue
                attempts = [a for a in map(_clean_attempt, entry["attempts"]) if a] \
                    if isinstance(entry.get("attempts"), list) else []
                exercises[eid] = _exercise_entry(attempts[-ATTEMPTS_KEPT:], _clean_attempt(entry.get("best")))
        layout_hash = data.get("layoutHash") if isinstance(data, dict) else None
        return {"format": PROGRESS_FORMAT, "lessonSet": set_id,
                "layoutHash": layout_hash if isinstance(layout_hash, str) else None, "exercises": exercises}

    def _load_progress(self, uid, set_id, for_write=False):
        """ The progress file named exactly set_id (_has_file), as _load """
        path = self._progress_path(uid, set_id)
        return self._load(path, for_write) if self._has_file(path) else None

    def progress(self, uid, set_id):
        """ The progress on a lesson set (lesson-format.md section 4); empty when nothing was recorded yet """
        with self.lock:
            data = self._load_progress(uid, set_id)
        return self._clean_progress(set_id, data)

    def record(self, uid, set_id, exercise_id, attempt):
        """ An exercise typed to the end: attempt = {at, chars, errors, seconds}; accuracy and WPM are computed here,
        the exercise is done, its best attempt the one with the highest accuracy then WPM (of all time), and the last
        ATTEMPTS_KEPT attempts are kept; the progress of exercises the set no longer has is dropped. NotFound when the
        set has no such exercise; ValueError for numbers that can't be. Returns the exercise's progress entry. """
        chars, errors, seconds = attempt.get("chars"), attempt.get("errors"), attempt.get("seconds")
        if not all(_number(v) for v in (chars, errors, seconds)) or not isinstance(attempt.get("at"), str):
            raise ValueError("an attempt has at (a string), chars, errors and seconds (finite numbers)")
        if any(isinstance(v, float) and not v.is_integer() for v in (chars, errors)):
            raise ValueError("an attempt's chars and errors are whole numbers")
        if chars < 1 or errors < 0 or errors > chars or seconds <= 0:
            raise ValueError("an attempt has at least one character, no more errors than characters and some time")
        if isinstance(seconds, float) and seconds.is_integer():
            seconds = int(seconds)
        entry = {"at": attempt["at"], "chars": int(chars), "errors": int(errors),
                 "accuracy": round(100 * (chars - errors) / chars, 1), "wpm": round(chars / 5 / (seconds / 60), 1),
                 "seconds": seconds}
        with self.lock:
            lesson_set, error = self._read_set_named(uid, set_id)
            if error:
                raise ValueError("lesson set {}: {}".format(set_id, error))
            exercises = {ex["id"] for lesson in lesson_set["lessons"] for ex in lesson["exercises"]}
            if exercise_id not in exercises:
                raise NotFound("lesson set {} has no exercise {!r}".format(set_id, exercise_id))
            progress = self._clean_progress(set_id, self._load_progress(uid, set_id, for_write=True))
            progress["exercises"] = {eid: e for eid, e in progress["exercises"].items() if eid in exercises}
            before = progress["exercises"].get(exercise_id) or {"best": None, "attempts": []}
            progress["exercises"][exercise_id] = _exercise_entry((before["attempts"] + [entry])[-ATTEMPTS_KEPT:],
                                                                 before["best"])
            progress["layoutHash"] = lesson_set["layout"]["hash"]
            self._save(self._progress_path(uid, set_id), progress)
        return progress["exercises"][exercise_id]

    # ---------- settings ----------

    @staticmethod
    def _check_settings(data, partial):
        """ The settings in data that are valid (partial: a saved file, where anything else is left out) or all of
        them (not partial: a change, where anything wrong is a ValueError) """
        out = {}
        for name, check, what in (("passAccuracy", lambda v: isinstance(v, int) and not isinstance(v, bool) and 50 <= v <= 100,
                                   "a whole number from 50 to 100"),
                                  ("targetWpm", lambda v: isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 300,
                                   "a whole number from 1 to 300"),
                                  ("pictureInWords", lambda v: isinstance(v, bool), "true or false")):
            value = data.get(name) if isinstance(data, dict) else None
            if check(value):
                out[name] = value
            elif not partial:
                raise ValueError("{} must be {}".format(name, what))
        return out

    def settings(self, uid):
        """ {passAccuracy, targetWpm, pictureInWords}: what is saved, the defaults for the rest """
        with self.lock:
            data = self._load(os.path.join(self._dir(uid), "settings.json"))
        return {**DEFAULT_SETTINGS, **self._check_settings(data, partial=True)}

    def set_settings(self, uid, data):
        """ Save the settings (all three); ValueError when one is out of its range. Returns them. """
        clean = self._check_settings(data, partial=False)
        with self.lock:
            path = os.path.join(self._dir(uid), "settings.json")
            self._load(path, for_write=True)
            self._save(path, clean)
        return dict(clean)
