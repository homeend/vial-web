#!/usr/bin/env python3
"""Turn the app's keyboard model (GET /api/keyboard) into a layout export for the lesson generator.

    python util/learning/export_layout.py keyboard.json [--fingers fingers.json] [-o layout-export.json]

A stand-in for the app's Learning → Fingers → Export until phase 2 builds it (docs/learning/lesson-format.md
section 2). Fingers come from the key positions by the rules of lesson-rules.md section 2; a fingers.json
(section 2.3) overrides them. Standard library only.
"""

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timezone

FINGERS_OUT = ["index", "middle", "ring", "pinky"]  # from the gap outwards
LAYER_KEY = re.compile(r"^(MO|OSL|TG|TO|TT|DF|PDF)\((\d+)\)$")
LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")
HOW = {"MO": "hold", "OSL": "oneShot", "TG": "toggle", "TT": "hold", "TO": "switch", "DF": "switch", "PDF": "switch"}


def char_of(legend, code, tap_code):
    """{"tap", "shift", "altGr"} typed by a basic key, or None when it types nothing printable"""
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


def describe_key(k, tap_dances):
    """(chars, hold label, layer key) of one described key on one layer"""
    code = k.get("code") or "KC_NO"
    if code in ("KC_NO", "KC_TRNS"):
        return None, None, None, code == "KC_TRNS"
    hold = k.get("hold")
    layer_key = None
    m = LAYER_KEY.match(code)
    if m:
        layer_key = {"layer": int(m.group(2)), "how": HOW[m.group(1)]}
        return None, None, layer_key, False
    m = LAYER_TAP.match(code)
    if m:
        layer_key = {"layer": int(m.group(1)), "how": "hold"}
        hold = f"layer {m.group(1)}"
    td = re.match(r"^TD\((\d+)\)$", code)
    if td and int(td.group(1)) < len(tap_dances):
        dance = tap_dances[int(td.group(1))]
        tap = dance.get("tap") or {}
        chars = char_of(tap.get("legend"), tap.get("code"), tap.get("tapCode"))
        h = dance.get("hold") or {}
        hm = LAYER_KEY.match(h.get("code") or "")
        if hm:
            layer_key = {"layer": int(hm.group(2)), "how": HOW[hm.group(1)]}
            hold = f"layer {hm.group(2)}"
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
    """the key's centre in key units, rotated the way the picture draws it (web/src/keyboard/geometry.ts)"""
    x, y = g["x"] + g["w"] / 2, g["y"] + g["h"] / 2
    r = g.get("r") or 0
    if not r:
        return round(x, 2), round(y, 2)
    rx, ry = g.get("rx") or 0, g.get("ry") or 0
    a = math.radians(r)
    dx, dy = x - rx, y - ry
    return round(rx + dx * math.cos(a) - dy * math.sin(a), 2), round(ry + dx * math.sin(a) + dy * math.cos(a), 2)


def key_id(g):
    return f"r{g['row']}c{g['col']}"


def grid(value, origin):
    """which 1u row or column a centre falls in, counted from the first one (column stagger is under half a key)"""
    return math.floor(value - origin + 0.5)


def propose_fingers(model, tap0, rest_pref):
    """key id -> {hand, finger, row, reach, home} from the positions and what layer 0 types.
    `tap0`: id -> the character tapped on layer 0; `rest_pref`: id -> 2 for Space, 1 for Enter (thumb resting keys)"""
    keys = model["keys"]
    pos = {key_id(g): centre(g) for g in keys}
    xs = sorted({p[0] for p in pos.values()})
    # the hand split is the widest gap between key centres
    gap_at = max(zip(xs, xs[1:]), key=lambda p: p[1] - p[0])
    split = (gap_at[0] + gap_at[1]) / 2
    letter = {kid: bool(c) and c.isalpha() for kid, c in tap0.items()}
    out = {}
    for hand in ("left", "right"):
        hand_keys = [g for g in keys if (pos[key_id(g)][0] < split) == (hand == "left")]
        if not hand_keys:
            continue
        y0 = min(pos[key_id(g)][1] for g in hand_keys)
        x0 = min(pos[key_id(g)][0] for g in hand_keys)
        row_idx = {key_id(g): grid(pos[key_id(g)][1], y0) for g in hand_keys}
        col_idx = {key_id(g): grid(pos[key_id(g)][0], x0) for g in hand_keys}
        rows = sorted(set(row_idx.values()))
        # the three rows with the most letters are top / home / bottom; anything below is the thumbs
        letters_in_row = {r: sum(1 for g in hand_keys if row_idx[key_id(g)] == r and letter[key_id(g)]) for r in rows}
        main_rows = sorted(sorted(rows, key=lambda r: -letters_in_row[r])[:3])
        row_name = {}
        for r in rows:
            if r in main_rows:
                row_name[r] = ("top", "home", "bottom")[main_rows.index(r)]
            elif r < main_rows[0]:
                row_name[r] = "number"
            else:
                row_name[r] = "thumb"
        home_row = main_rows[1] if len(main_rows) > 1 else main_rows[0]
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
        thumbs = [g for g in hand_keys if row_of[key_id(g)] == "thumb"]
        # the thumb's resting key: Space, else Enter, else the widest, else the one nearest the index finger
        thumb_rest = None
        if thumbs:
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
            if x in finger_of:
                finger = finger_of[x]
                reach = {"home": "rest", "top": "up", "bottom": "down", "number": "up"}[row]
            elif x in inner_cols:
                finger, reach = "index", "inner"
            elif x in outer_cols:
                finger, reach = "pinky", "outer"
            else:
                finger, reach = "index", "inner"
            out[kid] = {"hand": hand, "finger": finger, "row": row, "reach": reach,
                        "home": row == "home" and reach == "rest"}
    return out


def build(model, fingers_file=None):
    tap_dances = model.get("tapDance") or []
    tap0, rest_pref = {}, {}
    for g, k in zip(model["keys"], model["layers"][0]["keys"]):
        chars, _, _, _ = describe_key(k, tap_dances)
        tap0[key_id(g)] = (chars or {}).get("tap")
        if tap0[key_id(g)] == " ":
            rest_pref[key_id(g)] = 2
        elif k.get("tapCode") == "KC_ENTER" or k.get("code") == "KC_ENTER":
            rest_pref[key_id(g)] = 1
    proposal = propose_fingers(model, tap0, rest_pref)
    if fingers_file:
        for kid, change in (fingers_file.get("keys") or {}).items():
            if kid in proposal:
                proposal[kid].update({k: v for k, v in change.items() if k in ("finger", "reach", "hand", "row")})
        if "home" in fingers_file:
            for kid in proposal:
                proposal[kid]["home"] = kid in fingers_file["home"]
                if kid in fingers_file["home"] and proposal[kid]["finger"] != "thumb":
                    proposal[kid]["reach"] = "rest"
    layers = model["layers"]
    keys_out = {}
    layer_reach = {l["index"]: [] for l in layers}
    shift_keys = []
    for g, k0 in zip(model["keys"], layers[0]["keys"]):
        kid = f"r{g['row']}c{g['col']}"
        chars_by_layer, layer_key, hold0 = {}, None, None
        for layer in layers:
            k = layer["keys"][model["keys"].index(g)]
            chars, hold, lk, transparent = describe_key(k, tap_dances)
            if transparent and layer["index"] != 0:
                k = k0
                chars, hold, lk, _ = describe_key(k0, tap_dances)
            if layer["index"] == 0:
                layer_key, hold0 = lk, hold
                if k.get("code") in ("KC_LSHIFT", "KC_RSHIFT") or (hold and hold.lower().endswith("shift")):
                    shift_keys.append({"key": kid, "hand": proposal[kid]["hand"],
                                       "label": "Shift" if k.get("code") in ("KC_LSHIFT", "KC_RSHIFT") else f"{(k.get('legend') or {}).get('main')} (hold)"})
            if lk and lk["layer"] in layer_reach and layer["index"] == 0:
                label = {"hold": "hold", "oneShot": "tap", "toggle": "toggle with", "switch": "switch with"}[lk["how"]]
                tap = (chars or {}).get("tap")
                name = "Space" if tap == " " else (tap.upper() if tap else (k.get("legend") or {}).get("main") or kid)
                layer_reach[lk["layer"]].append({"key": kid, "how": lk["how"], "label": f"{label} {name}"})
            if chars:
                entry = dict(chars)
                if hold and layer["index"] == 0:
                    entry["hold"] = hold
                chars_by_layer[str(layer["index"])] = entry
            elif hold and layer["index"] == 0 and not chars:
                chars_by_layer.setdefault("0", {})["hold"] = hold
        x, y = centre(g)
        entry = {"id": kid, **proposal[kid], "x": x, "y": y, "chars": chars_by_layer}
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
        "format": "vial-web-layout-export/1",
        "keyboard": {"name": model["name"], "uid": model["uid"]},
        "hash": f"sha256:{digest[:16]}",
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "language": "en-us",
        "layers": [{"index": l["index"], "name": l.get("customName") or l["name"], "reachedBy": layer_reach[l["index"]]}
                   for l in layers if str(l["index"]) in reachable],
        "shiftKeys": shift_keys,
        "keys": [keys_out[k] for k in sorted(keys_out, key=lambda kid: (keys_out[kid]["y"], keys_out[kid]["x"]))],
    }


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
    export = build(model, fingers)
    text = json.dumps(export, indent=1, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
        letters = sorted(c["0"]["tap"] for k in export["keys"] for c in [k["chars"]] if "0" in c and c["0"].get("tap", "").isalpha())
        print(f"{args.out}: {len(export['keys'])} keys, {len(export['layers'])} layers with characters, "
              f"letters on layer 0: {''.join(letters)}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
