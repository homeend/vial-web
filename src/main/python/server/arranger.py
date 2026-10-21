# SPDX-License-Identifier: GPL-2.0-or-later
""" Arranging a keyboard's layers (server.layers) on the keyboard itself: its loaded state read into a KeyboardState,
and a KeyboardState written back, only what differs, in a fixed order. An arrange stopped partway is kept, by keyboard
(key_of), while the server runs: Finish writes the rest of it, Put back writes the state from before; neither writes
over what was changed since.

The functions that take the loaded Keyboard are called by DeviceManager.run, which holds the device lock.
"""
import dataclasses
import logging
import threading
from typing import Optional

from keycodes.keycodes import Keycode, RESET_KEYCODE
from macro.macro_action import ActionDelay, ActionSequence, ActionText, tag_to_action
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.constants import BUFFER_FETCH_CHUNK
from protocol.key_override import KeyOverrideEntry
from protocol.unlock_hook import request_unlock
from server import layers, model, schemas
from server.describe import keycode_protocol

log = logging.getLogger(__name__)


def _value(code):
    return Keycode.deserialize(code)


def _code(value):
    """ A firmware keycode as the protocol layer keeps it """
    return Keycode.normalize(Keycode.serialize(value))


def _steps(actions):
    """ A macro's protocol actions -> its steps, as KeyboardState has them """
    out = []
    for action in actions:
        if isinstance(action, ActionText):
            out.append(("text", action.text))
        elif isinstance(action, ActionDelay):
            out.append(("delay", action.delay))
        elif isinstance(action, ActionSequence):
            out.append((action.tag, tuple(_value(code) for code in action.sequence)))
    return tuple(out)


def _actions(steps):
    """ A macro's steps -> protocol actions """
    out = []
    for step in steps:
        if step[0] == "text":
            out.append(ActionText(step[1]))
        elif step[0] == "delay":
            out.append(ActionDelay(step[1]))
        else:
            out.append(tag_to_action[step[0]]([_code(value) for value in step[1]]))
    return out


def read_state(kb):
    """ The loaded keyboard -> KeyboardState (no device I/O) """
    return layers.KeyboardState(
        layers=kb.layers,
        keys={pos: _value(code) for pos, code in kb.layout.items()},
        encoders={pos: _value(code) for pos, code in kb.encoder_layout.items()},
        tap_dance=tuple(tuple(_value(c) for c in e[:4]) + (e[4],) for e in kb.tap_dance_entries),
        combos=tuple(tuple(_value(c) for c in e) for e in kb.combo_entries),
        key_overrides=tuple((_value(e.trigger), _value(e.replacement), e.layers, e.trigger_mods, e.negative_mod_mask,
                             e.suppressed_mods, e.options.serialize()) for e in kb.key_override_entries),
        alt_repeat_keys=tuple((_value(e.keycode), _value(e.alt_keycode), e.allowed_mods, e.options.serialize())
                              for e in kb.alt_repeat_key_entries),
        macros=tuple(_steps(actions) for actions in kb.macros_deserialize(kb.macro)),
    )


def _macro_data(kb, macros):
    """ The macro buffer for these macros' steps: the bytes the keyboard holds for each macro whose steps don't change
    (so a macro that reads back otherwise than it was written stays as it is), the others written anew. ValueError when
    it doesn't fit the macro memory. """
    held = (kb.macro.split(b"\x00") + [b""] * kb.macro_count)[:kb.macro_count]
    current = [_steps(actions) for actions in kb.macros_deserialize(kb.macro)]
    data = b"".join((held[i] if steps == current[i] else kb.macro_serialize(_actions(steps))) + b"\x00"
                    for i, steps in enumerate(macros))
    if len(data) > kb.macro_memory:
        raise ValueError("the macros would need {} bytes but the keyboard has {}".format(len(data), kb.macro_memory))
    return data


@dataclasses.dataclass
class Plan:
    """ What writing a KeyboardState to the keyboard takes: each write, in order. Built from what the keyboard holds;
    nothing is written to build it. """
    keys: list
    """ ((layer, row, col), keycode string) """
    encoders: list
    tap_dance: list
    """ (index, entry as the protocol layer keeps it) """
    combos: list
    key_overrides: list
    alt_repeat_keys: list
    macro: Optional[bytes] = None
    """ the macro buffer, when it changes """
    kept: int = 0
    """ keys, encoder directions, entries and macros left as they are: changed since an arrange stopped (plan's
    known) """

    @property
    def writes(self):
        """ How many writes it takes: one per key, encoder direction and entry, and one for the macro buffer """
        return (len(self.keys) + len(self.encoders) + len(self.tap_dance) + len(self.combos) + len(self.key_overrides)
                + len(self.alt_repeat_keys) + (self.macro is not None))

    def needs_unlock(self):
        """ Whether the keyboard must be unlocked for it, by the protocol layer's rules: QK_BOOT written anywhere, or the
        macros (which the protocol always writes unlocked) """
        def boot(code):
            return code == RESET_KEYCODE
        return any((
            any(boot(c) for _, c in self.keys), any(boot(c) for _, c in self.encoders),
            any(any(boot(c) for c in e[:4]) for _, e in self.tap_dance),
            any(boot(e[4]) for _, e in self.combos),
            any(boot(e.replacement) for _, e in self.key_overrides),
            any(boot(e.keycode) or boot(e.alt_keycode) for _, e in self.alt_repeat_keys),
            self.macro is not None,
        ))


def _nth(entries, index):
    """ entries[index], or None past their end """
    return entries[index] if index < len(entries) else None


def _chunks_of(held, buffers, start=0, end=None, past_end=True):
    """ Whether each piece of held[start:end] (a macro buffer the keyboard holds) between the protocol's write chunks
    (BUFFER_FETCH_CHUNK bytes, from offset 0) holds the bytes one of `buffers` has there: a buffer written partway over
    another holds the new one's first chunks, then the old one's. past_end: bytes past the end of a buffer match it (the
    keyboard's memory there is unknown) """
    end = len(held) if end is None else end
    at = start
    while at < end:
        stop = min(end, (at // BUFFER_FETCH_CHUNK + 1) * BUFFER_FETCH_CHUNK)
        piece = held[at:stop]
        if not any((piece[:max(0, len(b) - at)] if past_end else piece) == b[at:stop] for b in buffers):
            return False
        at = stop
    return True


def _macros_of(kb, held, known, buffers):
    """ For each macro the keyboard holds (held: their steps), whether it is a known state's: its steps are one of
    theirs, or its bytes, terminator included, are theirs in each piece between write chunks (_chunks_of: a macro the
    stop cut through) """
    pieces = (kb.macro.split(b"\x00") + [b""] * kb.macro_count)[:kb.macro_count]
    out, at = [], 0
    for index, piece in enumerate(pieces):
        end = at + len(piece) + 1
        out.append(_nth(held, index) in [_nth(k.macros, index) for k in known]
                   or _chunks_of(kb.macro, buffers, at, end, past_end=False))
        at = end
    return out


def plan(kb, target, known=(), buffers=(), buffer=None):
    """ The writes that make the keyboard hold `target` (a KeyboardState of its layers): only what differs. ValueError
    when the target's macros don't fit.

    known: KeyboardStates the keyboard is known to hold part of (an arrange's start and target). A key, an encoder
    direction, an entry or a macro that holds the value of none of them was changed since (an edit, a layout file
    loaded): it is left as it is, and counted in Plan.kept. None known: everything that differs is written.
    buffers: the macro buffers of the known states; buffer: the target's, written whole when the macro buffer holds
    theirs in each chunk (a macro write that stopped between chunks leaves a mix of both).
    """
    state = read_state(kb)
    kept = []

    def ours(held, theirs):
        """ whether `held` is the value one of the known states has there (theirs: their values); counted when not """
        if not known or held in theirs:
            return True
        kept.append(held)
        return False

    keys = [(pos, _code(value)) for pos, value in sorted(target.keys.items())
            if pos in state.keys and state.keys[pos] != value
            and ours(state.keys[pos], [k.keys.get(pos) for k in known])]
    encoders = [(pos, _code(value)) for pos, value in sorted(target.encoders.items())
                if pos in state.encoders and state.encoders[pos] != value
                and ours(state.encoders[pos], [k.encoders.get(pos) for k in known])]

    def differing(name, held, convert):
        """ the entries of KeyboardState field `name` to write; held: the keyboard's, as the protocol keeps them """
        out = []
        for index, entry in enumerate(getattr(target, name)):
            new = convert(entry)
            if index < len(held) and new != held[index] and ours(
                    getattr(state, name)[index], [_nth(getattr(k, name), index) for k in known]):
                out.append((index, new))
        return out

    tap_dance = differing("tap_dance", kb.tap_dance_entries, lambda e: tuple(_code(c) for c in e[:4]) + (e[4],))
    combos = differing("combos", kb.combo_entries, lambda e: tuple(_code(c) for c in e))
    key_overrides = differing("key_overrides", kb.key_override_entries,
                              lambda e: KeyOverrideEntry((_code(e[0]), _code(e[1])) + tuple(e[2:])))
    alt_repeat_keys = differing("alt_repeat_keys", kb.alt_repeat_key_entries,
                                lambda e: AltRepeatKeyEntry((_code(e[0]), _code(e[1])) + tuple(e[2:])))
    macro = None
    if tuple(target.macros) != state.macros:
        if not known:
            data = _macro_data(kb, target.macros)
        elif buffer is not None and _chunks_of(kb.macro, buffers):
            # all of it is theirs (a buffer written partway over another, say): written whole
            data = buffer
        else:
            # macro by macro: one that is none of theirs is left as it is
            mine = _macros_of(kb, state.macros, known, buffers)
            kept.extend(index for index, theirs in enumerate(mine) if not theirs)
            data = _macro_data(kb, [steps if theirs else held
                                    for steps, held, theirs in zip(target.macros, state.macros, mine)])
        macro = data if data != kb.macro else None
    return Plan(keys, encoders, tap_dance, combos, key_overrides, alt_repeat_keys, macro, len(kept))


def write(kb, todo, written):
    """ Write a Plan, in its order: keymap and encoders; tap dance, combos, key overrides, alt-repeat keys; then the
    macros. written: a list that gets one item per write done, so that a failure partway tells how far it got. """
    for (layer, row, col), code in todo.keys:
        kb.set_key(layer, row, col, code)
        written.append(1)
    for (layer, index, direction), code in todo.encoders:
        kb.set_encoder(layer, index, direction, code)
        written.append(1)
    for setter, entries in ((kb.tap_dance_set, todo.tap_dance), (kb.combo_set, todo.combos),
                            (kb.key_override_set, todo.key_overrides),
                            (kb.alt_repeat_key_set, todo.alt_repeat_keys)):
        for index, entry in entries:
            setter(index, entry)
            written.append(1)
    if todo.macro is not None:
        # deliberate, though the Job asked for the unlock before the first write: the protocol layer writes the macros
        # only right after request_unlock (as Keyboard.restore_macros and a layout file's apply do), and the keyboard may
        # have been locked since (by another program). The server's handler only reads the unlock status: no write.
        request_unlock(kb)
        kb.set_macro(todo.macro)
        written.append(1)


def _problem_text(problem):
    """ A layers.Problem as the API says it: "where: what" """
    return "{}: {}".format(problem.where, problem.text)


def preview(kb, order):
    """ What arranging the layers to `order` would change -> schemas.ArrangePreview. Nothing is written; it works on a
    locked keyboard too (needsUnlock says whether writing it needs the keyboard unlocked). ValueError for an order
    that isn't the keyboard's layers with layer 0 first. """
    result = layers.arrange(read_state(kb), order, keycode_protocol())
    try:
        todo = plan(kb, result.target)
    except ValueError as e:
        todo = None
        problems = [str(e)]
    else:
        problems = []
    return schemas.ArrangePreview(
        moves=[schemas.LayerMove(layer=old, to=new) for old, new in result.moves],
        keys=result.keys,
        references=schemas.ArrangeReferences(**result.references),
        keyOverrides=result.key_overrides,
        triLayer=None if result.tri_layer is None else list(result.tri_layer),
        problems=[_problem_text(p) for p in result.problems] + problems,
        writes=0 if todo is None else todo.writes,
        needsUnlock=False if todo is None else todo.needs_unlock(),
    )


class ArrangeRefused(Exception):
    """ An arrange that can't be written now: one of this keyboard is unfinished, or the order has problems """


class NothingUnfinished(LookupError):
    """ Finish or Put back with no arrange of this keyboard left unfinished """


class NamesNotSaved(Exception):
    """ Every write of an arrange went through, but its layer names couldn't be saved (another program holding the
    names file, say): it is kept unfinished, for Finish to save them (it writes nothing else) or Put back. Not an OSError
    or RuntimeError, which would read as the keyboard failing. """


@dataclasses.dataclass
class Unfinished:
    """ An arrange that stopped partway: the keyboard holds part of `target`, and of `start` """
    start: layers.KeyboardState
    target: layers.KeyboardState
    order: list
    done: int
    """ writes done by the last attempt before it stopped """
    total: int
    """ writes the last attempt had to do """
    start_macro: bytes
    """ the macro buffer of start, as the keyboard held it """
    target_macro: bytes
    """ the macro buffer of target, as it is written """


class Arrangements:
    """ The arranges left unfinished, by keyboard (key_of), while the server runs; safe across threads """

    def __init__(self):
        self._unfinished = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            return self._unfinished.get(key)

    def keep(self, key, unfinished):
        with self._lock:
            self._unfinished[key] = unfinished

    def drop(self, key):
        with self._lock:
            self._unfinished.pop(key, None)


def key_of(kb, keyboard_id):
    """ What an unfinished arrange is kept by: the keyboard's UID (its names' too) and keyboard_id, the id the keyboard
    open is listed by (KeyboardInfo.id). The UID alone is shared by every keyboard built from one firmware; the id tells
    them apart by their own USB serial number, else only by a number among keyboards alike, which two of them replugged
    can swap (keyboard_infos). So unfinished_of also checks the keyboard holds what the arrange wrote. """
    return model.uid_of(kb), keyboard_id


def unfinished_of(kb, keyboard_id, arrangements):
    """ The arrange of this keyboard left unfinished, or None. One kept under its key (key_of) is taken for this
    keyboard's only when more than half of the keymap positions it changes hold its start's or its target's value (any
    when it changes none): a keyboard that got another's id after a replug holds neither in most of them, unless both
    keymaps are alike, when Finish or Put back writes only what holds one of them anyway. """
    unfinished = arrangements.get(key_of(kb, keyboard_id))
    if unfinished is None:
        return None
    start, target = unfinished.start.keys, unfinished.target.keys
    changed = [pos for pos, value in start.items() if target.get(pos) != value]
    held = sum(1 for pos in changed if pos in kb.layout and _value(kb.layout[pos]) in (start[pos], target.get(pos)))
    return unfinished if 2 * held > len(changed) or not changed else None


class Job:
    """ Writing a state to the keyboard as part of an arrange (start -> target, by order), under the device lock.
    Planned and unlocked for when made: nothing is written before run(), which writes `writing`, then calls done(). Any
    failure in run() (of any write, even the first, or of done(), which saves the names) keeps the arrange as
    Unfinished, for Finish or Put back.

    Only what holds the value of start or target is written: anything else was changed since an arrange stopped (an
    edit, a layout file loaded) and is left as it is (plan's known), and logged. """

    def __init__(self, kb, key, start, target, order, arrangements, done, macros, finish=True):
        """ macros: the macro buffers of start and target; finish: write target (else start) """
        self.kb = kb
        self.key = key
        self.start, self.target, self.order = start, target, list(order)
        self.arrangements = arrangements
        self.done = done
        self.macros = tuple(macros)
        self.todo = plan(kb, target if finish else start, (start, target), self.macros, self.macros[1 if finish else 0])
        self.written = []
        if self.todo.needs_unlock():
            request_unlock(kb)

    def run(self):
        try:
            write(self.kb, self.todo, self.written)
            try:
                self.done()
            except Exception as e:
                raise NamesNotSaved("The layers were arranged, but the layer names couldn't be saved: {}"
                                    .format(e)) from e
        except Exception:
            # even the first write may have reached the keyboard, its answer lost: it may hold part of either state.
            # After every write, it holds `writing` (done == total): Finish then only saves the names.
            self.arrangements.keep(self.key, Unfinished(self.start, self.target, self.order, len(self.written),
                                                        self.todo.writes, *self.macros))
            raise
        if self.todo.kept:
            log.warning("arranging the layers: %d changed since the stop were kept as they are (keys, encoder "
                        "directions, entries and macros)", self.todo.kept)


def begin(kb, keyboard_id, order, arrangements, names):
    """ A Job arranging the keyboard's layers to `order`, computed from what it holds now. ArrangeRefused while an
    arrange of it is unfinished, or when the order has problems; ValueError for a bad order. The names move once every
    write has succeeded. keyboard_id: see key_of. """
    key = key_of(kb, keyboard_id)
    if unfinished_of(kb, keyboard_id, arrangements) is not None:
        raise ArrangeRefused("arranging this keyboard's layers stopped partway: finish it or put it back first")
    start = read_state(kb)
    result = layers.arrange(start, order, keycode_protocol())
    if result.problems:
        raise ArrangeRefused("the layers can't be arranged so: " + "; ".join(_problem_text(p) for p in result.problems))
    uid = model.uid_of(kb)
    return Job(kb, key, start, result.target, order, arrangements, lambda: names.move_layers(uid, order),
               (kb.macro, _macro_data(kb, result.target.macros)))


def resume(kb, keyboard_id, arrangements, names, finish):
    """ A Job writing the unfinished arrange of this keyboard to its end (finish: its target, then the names), or back
    to where it started (its start state; the names were never moved). What was changed since it stopped is left as it
    is (see Job). NothingUnfinished when there is none. keyboard_id: see key_of. """
    key = key_of(kb, keyboard_id)
    unfinished = unfinished_of(kb, keyboard_id, arrangements)
    if unfinished is None:
        raise NothingUnfinished("no arrange of this keyboard's layers is unfinished")
    uid = model.uid_of(kb)

    def done():
        if finish:
            names.move_layers(uid, unfinished.order)
        arrangements.drop(key)
    return Job(kb, key, unfinished.start, unfinished.target, unfinished.order, arrangements, done,
               (unfinished.start_macro, unfinished.target_macro), finish)
