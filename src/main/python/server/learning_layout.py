# SPDX-License-Identifier: GPL-2.0-or-later
""" The Learning feature's layout export (docs/learning/lesson-format.md section 2): which finger types each key, by
the rules of lesson-rules.md section 2, and what each key types on each layer. Pure functions over the keyboard's
model as a dict (schemas.KeyboardModel.model_dump(), the JSON of GET /api/keyboard), so that the server and
util/learning/export_layout.py share them. """
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import NamedTuple, Optional

FORMAT = "vial-web-layout-export/1"
FINGERS_OUT = ["index", "middle", "ring", "pinky"]
""" the finger columns from the gap outwards """
LAYER_KEY = re.compile(r"^(MO|OSL|TG|TO|TT|DF|PDF)\((\d+)\)$")
LAYER_MOD = re.compile(r"^LM\((\d+),.*\)$")
""" the LM(n, mods) spelling of a layer-modifier key. The API never emits it (describe gives the hex code with kind
"layer" and a layerAction starting "while held", which held_layer reads); it only serves hand-edited JSON """
LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")
TAP_DANCE = re.compile(r"^TD\((\d+)\)$")
HOW = {"MO": "hold", "OSL": "oneShot", "TG": "toggle", "TT": "hold", "TO": "switch", "DF": "switch", "PDF": "switch"}
""" how a layer key reaches its layer, by keycode; LM and the tri-layer keys are MO-like (see held_layer) """
TRI_LAYER = {"FN_MO13": 1, "FN_MO23": 2}
""" Vial's tri-layer keys: layer 1 or 2 while held (and layer 3 while both are, which no lesson teaches) """
HELD = "while held"
""" the start of Described.layerAction for a layer that is on while the key is held (LM, with or without modifiers) """
SPLIT_GAP = 1.0
""" a gap wider than this between neighbouring key centres (in key units) splits the board in two halves; without one
the board is one piece and the hands part between the home row's middle letters """
REACH_OF_ROW = {"home": "rest", "top": "up", "bottom": "down", "number": "up"}
""" a finger column's reach by row: the number row is always up (from the top row's finger); inner and outer are
reaches from the home row only """
SHIFT_CODES = ("KC_LSHIFT", "KC_RSHIFT")
SHIFT_HOLDS = ("Shift", "LShift", "RShift")
""" what a key that gives Shift alone is called: describe.mods_name of a lone left or right Shift (a mod-tap's hold,
a one-shot modifier's legend) and the legends of KC_LSHIFT / KC_RSHIFT (a tap dance's hold). Ctrl+Shift is not one """
ALT_GR_CODES = ("KC_RALT", "KC_ALGR", "KC_ROPT")
ALT_GR = "AltGr"
""" a plain right Alt: the keycode (and its aliases) and describe.mods_name of the modifier alone (RALT(KC_NO)) """


def char_of(legend, code, tap_code):
    """ {"tap", "shift", "altGr"} typed by a basic key, or None when it types nothing printable. A letter's shift is
    its capital (the legend's shifted character when the capital isn't one character: ß); any key's altGr is the
    legend's, as the keyboard language labels it (ą on KC_A in Polish) """
    if not legend:
        return None
    main = legend.get("main") or ""
    if code == "KC_SPACE" or tap_code == "KC_SPACE":
        return {"tap": " "}
    if len(main) != 1 or main.isspace():
        return None
    shifted, alt_gr = legend.get("shifted"), legend.get("altGr")
    if main.isalpha():
        out = {"tap": main.lower()}
        shifted = main.upper() if len(main.upper()) == 1 else shifted
    else:
        out = {"tap": main}
    if shifted and len(shifted) == 1:
        out["shift"] = shifted
    if alt_gr and len(alt_gr) == 1:
        out["altGr"] = alt_gr
    return out


def held_layer(k):
    """ The layer an LM or tri-layer key holds, or None. The API names LM by its number (a hex code) and the tri-layer
    keys FN_MO13 / FN_MO23, so these aren't found by the keycode name as MO(n) is. """
    code = k.get("code") or ""
    if code in TRI_LAYER:
        return TRI_LAYER[code]
    m = LAYER_MOD.match(code)
    if m:
        return int(m.group(1))
    if k.get("kind") == "layer" and isinstance(k.get("layer"), int) and (k.get("layerAction") or "").startswith(HELD):
        return k["layer"]
    return None


class KeyOnLayer(NamedTuple):
    """ What one described key does on one layer: `chars` is char_of's {"tap", "shift", "altGr"} or None; `hold` a
    short label for what holding it does ("Shift", "layer 2") or None; `layer_key` {"layer", "how"} when it reaches a
    layer; `transparent` when it is KC_TRNS (what layer 0 has there counts) """
    chars: Optional[dict]
    hold: Optional[str]
    layer_key: Optional[dict]
    transparent: bool


def describe_key(k, tap_dances):
    """ KeyOnLayer of one described key (schemas.Described as a dict) on one layer """
    code = k.get("code") or "KC_NO"
    if code in ("KC_NO", "KC_TRNS"):
        return KeyOnLayer(None, None, None, code == "KC_TRNS")
    hold = k.get("hold")
    layer_key = None
    m = LAYER_KEY.match(code)
    if m:
        return KeyOnLayer(None, None, {"layer": int(m.group(2)), "how": HOW[m.group(1)]}, False)
    held = held_layer(k)
    if held is not None:
        return KeyOnLayer(None, None, {"layer": held, "how": "hold"}, False)
    m = LAYER_TAP.match(code)
    if m:
        layer_key = {"layer": int(m.group(1)), "how": "hold"}
        hold = "layer {}".format(m.group(1))
    td = TAP_DANCE.match(code)
    if td and int(td.group(1)) < len(tap_dances):
        dance = tap_dances[int(td.group(1))]
        tap = dance.get("tap") or {}
        chars = char_of(tap.get("legend"), tap.get("code"), tap.get("tapCode"))
        h = dance.get("hold") or {}
        hm = LAYER_KEY.match(h.get("code") or "")
        if hm:
            layer_key = {"layer": int(hm.group(2)), "how": HOW[hm.group(1)]}
            hold = "layer {}".format(hm.group(2))
        elif h.get("code") not in (None, "KC_NO"):
            hold = (h.get("legend") or {}).get("main")
        return KeyOnLayer(chars, hold, layer_key, False)
    if k.get("kind") == "modifier":
        # a plain modifier types nothing, and no lesson drills it; but AltGr reaches characters, so a plain AltGr key
        # carries its hold for the picture to light (a mod-tap's AltGr hold comes with its characters below)
        alt_gr = code in ALT_GR_CODES or (k.get("legend") or {}).get("main") == ALT_GR
        return KeyOnLayer(None, ALT_GR if alt_gr else None, None, False)
    return KeyOnLayer(char_of(k.get("legend"), code, k.get("tapCode")), hold, layer_key, False)


def shift_label(k, hold):
    """ How a layer-0 key that gives Shift is listed in shiftKeys, or None: Shift itself, a one-shot Shift, or a key
    held for Shift alone (a mod-tap, a tap dance); `hold` is describe_key's label for it """
    legend = (k.get("legend") or {}).get("main")
    if k.get("code") in SHIFT_CODES:
        return "Shift"
    if k.get("kind") == "one-shot-mod" and legend in SHIFT_HOLDS:
        return "Shift (one-shot)"
    if hold in SHIFT_HOLDS:
        return "{} (hold)".format(legend)
    return None


def layout_choices(options):
    """ The chosen choice of each layout option, decoded as web/src/keyboard/geometry.ts's layoutChoices does: Vial
    packs them into one number, the first option in the highest bits; an on/off option takes one bit, a list of choices
    as many bits as its highest choice needs, at least one """
    if not options:
        return []
    value, choices = options["value"], []
    for label in reversed(options["labels"]):
        count = 2 if isinstance(label, str) else len(label) - 1
        size = 2 ** (1 if count <= 2 else (count - 1).bit_length())
        choices.insert(0, value % size)
        value //= size
    return choices


def visible_keys(model):
    """ (index, geometry) of the keys the picture draws, as the web UI's placeKeyboard has it: no decals, and of the
    keys of a layout option only the chosen choice's, moved to where the option's first choice is drawn (by the
    top-left corner of the keys' unrotated rectangles). The index is the key's place in model["keys"] and in every
    layer's "keys". """
    choices = layout_choices(model.get("layoutOptions"))
    keys = model.get("keys") or []
    top_left = {}
    for g in keys:
        if g.get("layoutIndex", -1) != -1:
            seen = top_left.get((g["layoutIndex"], g["layoutOption"]))
            top_left[(g["layoutIndex"], g["layoutOption"])] = \
                (min(seen[0], g["x"]), min(seen[1], g["y"])) if seen else (g["x"], g["y"])
    out = []
    for i, g in enumerate(keys):
        if g.get("decal"):
            continue
        index = g.get("layoutIndex", -1)
        if index != -1:
            if g.get("layoutOption") != (choices[index] if index < len(choices) else 0):
                continue
            own = top_left[(index, g["layoutOption"])]
            first = top_left.get((index, 0), own)
            dx, dy = first[0] - own[0], first[1] - own[1]
            if dx or dy:
                g = dict(g, x=g["x"] + dx, y=g["y"] + dy)
                if g.get("r"):
                    g.update(rx=(g.get("rx") or 0) + dx, ry=(g.get("ry") or 0) + dy)
        out.append((i, g))
    return out


def centre(g):
    """ The key's centre in key units, rotated the way the picture draws it (web/src/keyboard/geometry.ts) """
    x, y = g["x"] + g["w"] / 2, g["y"] + g["h"] / 2
    r = g.get("r") or 0
    if not r:
        return round(x, 2), round(y, 2)
    rx, ry = g.get("rx") or 0, g.get("ry") or 0
    a = math.radians(r)
    dx, dy = x - rx, y - ry
    return round(rx + dx * math.cos(a) - dy * math.sin(a), 2), round(ry + dx * math.sin(a) + dy * math.cos(a), 2)


def key_id(g):
    """ "r1c4": the key's id in the export, from its matrix position """
    return "r{}c{}".format(g["row"], g["col"])


def grid(value, origin):
    """ Which 1u row or column a centre falls in, counted from the first one (column stagger is under half a key) """
    return math.floor(value - origin + 0.5)


def row_names(keys, row_idx, letter):
    """ Row number -> "number", "top", "home", "bottom" or "thumb": the three rows with the most letters are top, home
    and bottom; anything above is the number row, anything below the thumbs. Also the home row's number. """
    rows = sorted(set(row_idx.values()))
    letters_in_row = {r: sum(1 for g in keys if row_idx[key_id(g)] == r and letter[key_id(g)]) for r in rows}
    main_rows = sorted(sorted(rows, key=lambda r: -letters_in_row[r])[:3])
    names = {}
    for r in rows:
        if r in main_rows:
            names[r] = ("top", "home", "bottom")[main_rows.index(r)]
        elif r < main_rows[0]:
            names[r] = "number"
        else:
            names[r] = "thumb"
    return names, main_rows[1] if len(main_rows) > 1 else main_rows[0]


def one_board_split(keys, pos, letter):
    """ Where the hands part on a board in one piece: between the two middle letters of the home row (g and h on
    QWERTY), the left hand taking the odd one. Halfway across when the home row has fewer than two letters. """
    y0 = min(p[1] for p in pos.values())
    row_idx = {key_id(g): grid(pos[key_id(g)][1], y0) for g in keys}
    _, home_row = row_names(keys, row_idx, letter)
    xs = sorted(pos[key_id(g)][0] for g in keys if row_idx[key_id(g)] == home_row and letter[key_id(g)])
    if len(xs) < 2:
        xs = sorted(p[0] for p in pos.values())
        return (xs[0] + xs[-1]) / 2
    left = (len(xs) + 1) // 2
    return (xs[left - 1] + xs[left]) / 2


def propose_fingers(keys, tap0, rest_pref):
    """ Key id -> {hand, finger, row, reach, home} from the positions (`keys`: the geometries the picture draws, see
    visible_keys) and what layer 0 types. `tap0`: id -> the character tapped on layer 0 (None for a key that types
    nothing printable); `rest_pref`: id -> 2 for Space, 1 for Enter (the thumbs' resting keys).

    A split board (a gap wider than SPLIT_GAP) parts at the gap, and each hand's finger columns come from the 1u
    columns whose home-row key types a character, counted from the gap outwards (a modifier or an arrow key in the
    home row is no finger's resting key): four are the fingers index to pinky; of five, the extra column is the end
    whose key is not a letter (comma on the Corne), or the inner end when both ends are letters (G and H on a QWERTY
    Corne); of six or more, the innermost is the extra one and the four after it the fingers. The extra inner column
    and any column nearer the gap are the index finger's inner reach, columns beyond the pinky its outer reach. A
    board in one piece parts between the home row's middle letters, and its rows are staggered, so each row counts
    its keys from the gap outwards instead: inner, index, middle, ring, pinky, outer. A board with one hand on it (a
    macropad, a lone half) has no gap either, so it is parted the same way, and the user corrects the fingers. The
    rows below the bottom letter row are the thumbs; the thumb rests on Space, else Enter, else the widest key, else
    the one nearest the index finger. The number row is always typed up, from the top row's finger. """
    if not keys:
        return {}
    pos = {key_id(g): centre(g) for g in keys}
    letter = {kid: bool(c) and c.isalpha() for kid, c in tap0.items()}
    xs = sorted({p[0] for p in pos.values()})
    # the hand split is the widest gap between key centres, when there is one
    gap_at = max(zip(xs, xs[1:]), key=lambda p: p[1] - p[0]) if len(xs) > 1 else (xs[0], xs[0])
    one_board = gap_at[1] - gap_at[0] <= SPLIT_GAP
    split = one_board_split(keys, pos, letter) if one_board else (gap_at[0] + gap_at[1]) / 2
    out = {}
    for hand in ("left", "right"):
        # a key right under the split (B on a row-stagger board, between G and H) is the left hand's; on a split board
        # no key centre lies in the gap
        hand_keys = [g for g in keys if (pos[key_id(g)][0] <= split) == (hand == "left")]
        if not hand_keys:
            continue
        y0 = min(pos[key_id(g)][1] for g in hand_keys)
        x0 = min(pos[key_id(g)][0] for g in hand_keys)
        row_idx = {key_id(g): grid(pos[key_id(g)][1], y0) for g in hand_keys}
        col_idx = {key_id(g): grid(pos[key_id(g)][0], x0) for g in hand_keys}
        row_name, home_row = row_names(hand_keys, row_idx, letter)
        row_of = {kid: row_name[r] for kid, r in row_idx.items()}
        # finger columns: of the home-row columns whose key types a character, from the gap outwards, four are the
        # fingers; of five, the extra one is the end whose key is not a letter (the inner end when both are); of six
        # or more, the innermost is the extra one
        cols = sorted({col_idx[kid] for kid in row_of if row_of[kid] != "thumb"})
        home_keys = [kid for kid in row_of if row_idx[kid] == home_row]
        typing_cols = sorted({col_idx[kid] for kid in home_keys if tap0.get(kid) is not None})
        letter_cols = {col_idx[kid] for kid in home_keys if letter[kid]}
        if hand == "left":
            typing_cols.reverse()  # nearest the gap first
        if len(typing_cols) == 5:
            extra_inner = typing_cols[0] not in letter_cols or typing_cols[-1] in letter_cols
            finger_cols = typing_cols[1:] if extra_inner else typing_cols[:4]
        else:
            finger_cols = typing_cols[1:5] if len(typing_cols) >= 6 else typing_cols
        finger_of = {c: FINGERS_OUT[i] for i, c in enumerate(finger_cols)}
        inner_cols = [c for c in cols if (c > finger_cols[0]) == (hand == "left")] if finger_cols else []
        outer_cols = [c for c in cols if (c < finger_cols[-1]) == (hand == "left")] if finger_cols else []
        # one board: each letter row's keys counted from the gap; position 0 is the inner reach, 1 to 4 the fingers,
        # the rest the pinky's outer reach. The number row is shifted half a key to the left of the letter rows, so
        # each of its keys is typed up from the nearest top-row key, a tie going to the one on the right (2 is above Q
        # and W, and the ring finger's; 8 above U and I, and the middle finger's)
        from_gap, one_board_fingers = {}, {}
        if one_board:
            for r in set(row_idx.values()):
                in_row = sorted((g for g in hand_keys if row_idx[key_id(g)] == r),
                                key=lambda g: abs(pos[key_id(g)][0] - split))
                from_gap.update({key_id(g): i for i, g in enumerate(in_row)})
            for kid, i in from_gap.items():
                if row_of[kid] in ("number", "thumb"):
                    continue
                if i == 0:
                    one_board_fingers[kid] = ("index", "inner")
                elif i <= 4:
                    one_board_fingers[kid] = (FINGERS_OUT[i - 1], REACH_OF_ROW[row_of[kid]])
                else:
                    one_board_fingers[kid] = ("pinky", "outer")
            top = [kid for kid in from_gap if row_of[kid] == "top"]
            for kid in from_gap:
                if row_of[kid] == "number":
                    if not top:
                        one_board_fingers[kid] = ("index" if from_gap[kid] == 0 else "pinky", "up")
                        continue
                    below = min(top, key=lambda t: (round(abs(pos[t][0] - pos[kid][0]), 2), -pos[t][0]))
                    one_board_fingers[kid] = (one_board_fingers[below][0], "up")
        thumbs = [g for g in hand_keys if row_of[key_id(g)] == "thumb"]
        # the thumb's resting key: Space, else Enter, else the widest, else the one nearest the index finger
        thumb_rest = None
        if thumbs:
            if one_board:
                index_keys = [kid for kid, i in from_gap.items() if i == 1 and row_idx[kid] == home_row]
                index_x = pos[index_keys[0]][0] if index_keys else split
            else:
                index_x = x0 + finger_cols[0] if finger_cols else split
            thumb_rest = max(thumbs, key=lambda g: (rest_pref.get(key_id(g), 0), g["w"], -abs(pos[key_id(g)][0] - index_x)))
        for g in hand_keys:
            kid = key_id(g)
            x = col_idx[kid]
            row = row_of[kid]
            if row == "thumb":
                if g is thumb_rest:
                    reach = "rest"
                else:
                    reach = "inner" if abs(pos[kid][0] - split) < abs(pos[key_id(thumb_rest)][0] - split) else "outer"
                out[kid] = {"hand": hand, "finger": "thumb", "row": row, "reach": reach, "home": g is thumb_rest}
                continue
            if one_board:
                finger, reach = one_board_fingers[kid]
            elif x in finger_of:
                finger, reach = finger_of[x], REACH_OF_ROW[row]
            else:
                finger, reach = ("pinky", "outer") if x in outer_cols else ("index", "inner")
                if row == "number":
                    reach = "up"
            out[kid] = {"hand": hand, "finger": finger, "row": row, "reach": reach,
                        "home": row == "home" and reach == "rest"}
    return out


def proposal(model):
    """ The app's finger proposal for the keyboard: key id -> {hand, finger, row, reach, home}, from the key positions
    and what layer 0 types """
    tap_dances = model.get("tapDance") or []
    layers = model.get("layers") or []
    visible = visible_keys(model) if layers else []
    tap0, rest_pref = {}, {}
    for i, g in visible:
        k = layers[0]["keys"][i]
        tap0[key_id(g)] = (describe_key(k, tap_dances).chars or {}).get("tap")
        if tap0[key_id(g)] == " ":
            rest_pref[key_id(g)] = 2
        elif k.get("tapCode") == "KC_ENTER" or k.get("code") == "KC_ENTER":
            rest_pref[key_id(g)] = 1
    return propose_fingers([g for _, g in visible], tap0, rest_pref)


def apply_fingers(proposal, fingers_file):
    """ The proposal with the user's corrections (a vial-web-fingers/1 file as a dict, or None) on top: a new dict.
    Keys the keyboard doesn't have are ignored; a resting key that isn't a thumb's gets the rest reach. """
    out = {kid: dict(entry) for kid, entry in proposal.items()}
    if not fingers_file:
        return out
    for kid, change in (fingers_file.get("keys") or {}).items():
        if kid in out and isinstance(change, dict):
            out[kid].update({k: v for k, v in change.items() if k in ("finger", "reach", "hand", "row")})
    if "home" in fingers_file:
        home = set(fingers_file["home"] or [])
        for kid in out:
            out[kid]["home"] = kid in home
            if kid in home and out[kid]["finger"] != "thumb":
                out[kid]["reach"] = "rest"
    return out


def export(model, fingers=None, language="en-us"):
    """ The layout export of the keyboard's model, with the user's finger corrections (apply_fingers) and the keyboard
    language the model was described in. `hash` covers the character map (every key's characters per layer and the
    layer access paths) and nothing else: a lesson set stays valid when a layer is renamed. """
    fingers_of = apply_fingers(proposal(model), fingers)
    tap_dances = model.get("tapDance") or []
    layers = model.get("layers") or []
    keys_out = {}
    layer_reach = {l["index"]: [] for l in layers}
    shift_keys = []
    for i, g in (visible_keys(model) if layers else []):
        kid = key_id(g)
        k0 = layers[0]["keys"][i]
        chars_by_layer, layer_key = {}, None
        for layer in layers:
            k = layer["keys"][i]
            chars, hold, lk, transparent = describe_key(k, tap_dances)
            if transparent and layer["index"] != 0:
                k = k0
                chars, hold, lk, _ = describe_key(k0, tap_dances)
            if layer["index"] == 0:
                layer_key = lk
                label = shift_label(k, hold)
                if label:
                    shift_keys.append({"key": kid, "hand": fingers_of[kid]["hand"], "label": label})
            if lk and lk["layer"] in layer_reach and layer["index"] == 0:
                label = {"hold": "hold", "oneShot": "tap", "toggle": "toggle with", "switch": "switch with"}[lk["how"]]
                tap = (chars or {}).get("tap")
                name = "Space" if tap == " " else (tap.upper() if tap else (k.get("legend") or {}).get("main") or kid)
                layer_reach[lk["layer"]].append({"key": kid, "how": lk["how"], "label": "{} {}".format(label, name)})
            if chars:
                entry = dict(chars)
                if hold and layer["index"] == 0:
                    entry["hold"] = hold
                chars_by_layer[str(layer["index"])] = entry
            elif hold and layer["index"] == 0 and not chars:
                chars_by_layer.setdefault("0", {})["hold"] = hold
        x, y = centre(g)
        entry = {"id": kid, **fingers_of[kid], "x": x, "y": y, "chars": chars_by_layer}
        if layer_key:
            entry["layerKey"] = layer_key
        keys_out[kid] = entry
    # only layer 0 and the layers a layer-0 key reaches count; characters on the others can't be typed
    reachable = {"0"} | {str(l) for l, rs in layer_reach.items() if rs}
    for e in keys_out.values():
        e["chars"] = {l: c for l, c in e["chars"].items() if l in reachable}
    triples = sorted((kid, layer, which, c) for kid, e in keys_out.items()
                     for layer, chars in e["chars"].items() for which, c in chars.items() if which != "hold")
    reach_pairs = sorted((str(l), r["key"], r["how"]) for l, rs in layer_reach.items() for r in rs)
    digest = hashlib.sha256(json.dumps([triples, reach_pairs]).encode()).hexdigest()
    return {
        "format": FORMAT,
        "keyboard": {"name": model["name"], "uid": model["uid"]},
        "hash": "sha256:{}".format(digest[:16]),
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "language": language,
        "layers": [{"index": l["index"], "name": l["name"], "reachedBy": layer_reach[l["index"]]}
                   for l in layers if str(l["index"]) in reachable],
        "shiftKeys": shift_keys,
        "keys": [keys_out[k] for k in sorted(keys_out, key=lambda kid: (keys_out[kid]["y"], keys_out[kid]["x"]))],
    }
