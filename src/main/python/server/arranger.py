# SPDX-License-Identifier: GPL-2.0-or-later
""" Arranging a keyboard's layers (server.layers) on the keyboard itself: its loaded state read into a KeyboardState,
and a KeyboardState written back, only what differs, in a fixed order. An arrange stopped partway is kept, by the
keyboard's UID, while the server runs: Finish writes the rest of it, Put back writes the state from before.

The functions that take the loaded Keyboard are called by DeviceManager.run, which holds the device lock.
"""
import dataclasses
import threading

from keycodes.keycodes import Keycode, RESET_KEYCODE
from macro.macro_action import ActionDelay, ActionSequence, ActionText, tag_to_action
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.key_override import KeyOverrideEntry
from protocol.unlock_hook import request_unlock
from server import layers, model, schemas
from server.describe import keycode_protocol


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
    macro: bytes = None
    """ the macro buffer, when it changes """

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


def plan(kb, target):
    """ The writes that make the keyboard hold `target` (a KeyboardState of its layers): only what differs. ValueError
    when the target's macros don't fit. """
    keys = [(pos, _code(value)) for pos, value in sorted(target.keys.items())
            if pos in kb.layout and _value(kb.layout[pos]) != value]
    encoders = [(pos, _code(value)) for pos, value in sorted(target.encoders.items())
                if pos in kb.encoder_layout and _value(kb.encoder_layout[pos]) != value]

    def differing(entries, held, convert):
        out = []
        for index, entry in enumerate(entries):
            new = convert(entry)
            if index < len(held) and new != held[index]:
                out.append((index, new))
        return out

    state = read_state(kb)
    tap_dance = differing(target.tap_dance, kb.tap_dance_entries,
                          lambda e: tuple(_code(c) for c in e[:4]) + (e[4],))
    combos = differing(target.combos, kb.combo_entries, lambda e: tuple(_code(c) for c in e))
    key_overrides = differing(target.key_overrides, kb.key_override_entries,
                              lambda e: KeyOverrideEntry((_code(e[0]), _code(e[1])) + tuple(e[2:])))
    alt_repeat_keys = differing(target.alt_repeat_keys, kb.alt_repeat_key_entries,
                                lambda e: AltRepeatKeyEntry((_code(e[0]), _code(e[1])) + tuple(e[2:])))
    macro = None
    if tuple(target.macros) != state.macros:
        data = _macro_data(kb, target.macros)
        macro = data if data != kb.macro else None
    return Plan(keys, encoders, tap_dance, combos, key_overrides, alt_repeat_keys, macro)


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
        request_unlock(kb)
        kb.set_macro(todo.macro)
        written.append(1)


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
        problems=["{}: {}".format(p.where, p.text) for p in result.problems] + problems,
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


class Arrangements:
    """ The arranges left unfinished, by keyboard UID, while the server runs; safe across threads """

    def __init__(self):
        self._unfinished = {}
        self._lock = threading.Lock()

    def get(self, uid):
        with self._lock:
            return self._unfinished.get(uid)

    def keep(self, uid, unfinished):
        with self._lock:
            self._unfinished[uid] = unfinished

    def drop(self, uid):
        with self._lock:
            self._unfinished.pop(uid, None)


class Job:
    """ Writing a state to the keyboard as part of an arrange (start -> target, by order), under the device lock.
    Planned and unlocked for when made: nothing is written before run(), which writes `writing`, then calls done(). A
    failure once something was written keeps the arrange as Unfinished, for Finish or Put back. """

    def __init__(self, kb, writing, start, target, order, arrangements, done):
        self.kb = kb
        self.uid = model.uid_of(kb)
        self.start, self.target, self.order = start, target, list(order)
        self.arrangements = arrangements
        self.done = done
        self.todo = plan(kb, writing)
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
            self.arrangements.keep(self.uid, Unfinished(self.start, self.target, self.order, len(self.written),
                                                        self.todo.writes))
            raise


def begin(kb, order, arrangements, names):
    """ A Job arranging the keyboard's layers to `order`, computed from what it holds now. ArrangeRefused while an
    arrange of it is unfinished, or when the order has problems; ValueError for a bad order. The names move once every
    write has succeeded. """
    uid = model.uid_of(kb)
    if arrangements.get(uid) is not None:
        raise ArrangeRefused("arranging this keyboard's layers stopped partway: finish it or put it back first")
    start = read_state(kb)
    result = layers.arrange(start, order, keycode_protocol())
    if result.problems:
        raise ArrangeRefused("the layers can't be arranged so: " + "; ".join(
            "{}: {}".format(p.where, p.text) for p in result.problems))
    return Job(kb, result.target, start, result.target, order, arrangements, lambda: names.move_layers(uid, order))


def resume(kb, arrangements, names, finish):
    """ A Job writing the unfinished arrange of this keyboard to its end (finish: its target, then the names), or back
    to where it started (its start state; the names were never moved). NothingUnfinished when there is none. """
    uid = model.uid_of(kb)
    unfinished = arrangements.get(uid)
    if unfinished is None:
        raise NothingUnfinished("no arrange of this keyboard's layers is unfinished")

    def done():
        if finish:
            names.move_layers(uid, unfinished.order)
        arrangements.drop(uid)
    writing = unfinished.target if finish else unfinished.start
    return Job(kb, writing, unfinished.start, unfinished.target, unfinished.order, arrangements, done)
