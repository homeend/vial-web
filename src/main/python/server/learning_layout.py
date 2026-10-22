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

FORMAT = "vial-web-layout-export/1"
FINGERS_OUT = ["index", "middle", "ring", "pinky"]
""" the finger columns from the gap outwards """
LAYER_KEY = re.compile(r"^(MO|OSL|TG|TO|TT|DF|PDF)\((\d+)\)$")
LAYER_MOD = re.compile(r"^LM\((\d+),.*\)$")
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
""" a finger column's reach by row: the number row is up from the top row's finger """


def char_of(legend, code, tap_code):
    """ {"tap", "shift", "altGr"} typed by a basic key, or None when it types nothing printable """
    if not legend:
        return None
    main = legend.get("main") or ""
    if code == "KC_SPACE" or tap_code == "KC_SPACE":
        return {"tap": " "}
    if len(main) == 1 and main.isalpha():
        return {"tap": main.lower(), "shift": main.upper()}
    if len(main) == 1 and not main.isspace():
        out = {"tap": main}
        if legend.get("shifted") and len(legend["shifted"]) == 1:
            out["shift"] = legend["shifted"]
        if legend.get("altGr") and len(legend["altGr"]) == 1:
            out["altGr"] = legend["altGr"]
        return out
    return None


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


def describe_key(k, tap_dances):
    """ (chars, hold label, layer key, transparent) of one described key (schemas.Described as a dict) on one layer """
    code = k.get("code") or "KC_NO"
    if code in ("KC_NO", "KC_TRNS"):
        return None, None, None, code == "KC_TRNS"
    hold = k.get("hold")
    layer_key = None
    m = LAYER_KEY.match(code)
    if m:
        layer_key = {"layer": int(m.group(2)), "how": HOW[m.group(1)]}
        return None, None, layer_key, False
    held = held_layer(k)
    if held is not None:
        return None, None, {"layer": held, "how": "hold"}, False
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
        return chars, hold, layer_key, False
    if k.get("kind") == "modifier":
        return None, None, None, False
    chars = char_of(k.get("legend"), code, k.get("tapCode"))
    if k.get("kind") == "mod-tap" or (hold and k.get("tapCode")):
        hold = hold or k.get("hold")
    return chars, hold, layer_key, False


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


def propose_fingers(model, tap0, rest_pref):
    """ Key id -> {hand, finger, row, reach, home} from the positions and what layer 0 types. `tap0`: id -> the
    character tapped on layer 0; `rest_pref`: id -> 2 for Space, 1 for Enter (the thumbs' resting keys).

    A split board (a gap wider than SPLIT_GAP) parts at the gap, and each hand's finger columns are the 1u columns
    whose home-row key is a letter, from the gap outwards; a column nearer the gap is the index finger's inner reach
    and columns beyond the pinky its outer reach. A board in one piece parts between the home row's middle letters,
    and its rows are staggered, so each row counts its keys from the gap outwards instead: inner, index, middle, ring,
    pinky, outer. The rows below the bottom letter row are the thumbs; the thumb rests on Space, else Enter, else the
    widest key, else the one nearest the index finger. """
    keys = model["keys"]
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
        # finger columns: the columns whose home-row key is a letter, from the gap outwards
        cols = sorted({col_idx[kid] for kid in row_of if row_of[kid] != "thumb"})
        home_letter_cols = sorted({col_idx[kid] for kid in row_of if row_idx[kid] == home_row and letter[kid]})
        if hand == "left":
            home_letter_cols.reverse()  # nearest the gap first
        finger_cols = home_letter_cols[:4]
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
                        one_board_fingers[kid] = ("index", "inner") if from_gap[kid] == 0 else ("pinky", "outer")
                        continue
                    below = min(top, key=lambda t: (round(abs(pos[t][0] - pos[kid][0]), 2), -pos[t][0]))
                    finger, reach = one_board_fingers[below]
                    one_board_fingers[kid] = (finger, reach if reach in ("inner", "outer") else "up")
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
            elif x in inner_cols:
                finger, reach = "index", "inner"
            elif x in outer_cols:
                finger, reach = "pinky", "outer"
            else:
                finger, reach = "index", "inner"
            out[kid] = {"hand": hand, "finger": finger, "row": row, "reach": reach,
                        "home": row == "home" and reach == "rest"}
    return out


def proposal(model):
    """ The app's finger proposal for the keyboard: key id -> {hand, finger, row, reach, home}, from the key positions
    and what layer 0 types """
    tap_dances = model.get("tapDance") or []
    tap0, rest_pref = {}, {}
    for g, k in zip(model["keys"], model["layers"][0]["keys"]):
        chars, _, _, _ = describe_key(k, tap_dances)
        tap0[key_id(g)] = (chars or {}).get("tap")
        if tap0[key_id(g)] == " ":
            rest_pref[key_id(g)] = 2
        elif k.get("tapCode") == "KC_ENTER" or k.get("code") == "KC_ENTER":
            rest_pref[key_id(g)] = 1
    return propose_fingers(model, tap0, rest_pref)


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
    layers = model["layers"]
    keys_out = {}
    layer_reach = {l["index"]: [] for l in layers}
    shift_keys = []
    for i, g in enumerate(model["keys"]):
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
                if k.get("code") in ("KC_LSHIFT", "KC_RSHIFT") or (hold and hold.lower().endswith("shift")):
                    shift = k.get("code") in ("KC_LSHIFT", "KC_RSHIFT")
                    label = "Shift" if shift else "{} (hold)".format((k.get("legend") or {}).get("main"))
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
