# Learning: file formats

_2026-10-21. The three JSON files of the Learning feature: the **layout export** the app writes for the generator,
the **lesson set** the generator writes for the app, and the **progress** file the app keeps. The lesson set has a
JSON Schema, [lesson-set.schema.json](lesson-set.schema.json), and a checker,
`util/learning/check_lessons.py`._

## 1. Where files live

Under the app's config folder (`platformdirs`, app name `Vial`: `%LOCALAPPDATA%\Vial` on Windows,
`~/.config/Vial` on Linux, `~/Library/Application Support/Vial` on macOS; `--data-dir` moves all of it):

```
learning/
  <keyboard uid>/
    fingers.json              the user's finger / resting-key corrections (section 2.3)
    layout-export.json        the last export (also offered as a download)
    sets/<set id>.json        lesson sets, imported or dropped in by hand
    progress/<set id>.json    progress per lesson set
    settings.json             the pass accuracy, the target WPM, the picture in word exercises (section 4)
```

Everything is plain JSON, UTF-8, written the way `names.json` is (temp file, fsync, replace). A lesson set file
that doesn't validate is listed with its error and not opened.

## 2. The layout export

What the app knows about the keyboard, reduced to what lessons need. Until the app's Learning page exists,
`util/learning/export_layout.py keyboard.json -o layout-export.json` makes one from a saved `GET /api/keyboard`
reply (the same rules; it is the prototype of the server's export). `examples/corne-sim-layout-export.json` is
the simulated Corne's. Example (two keys of it):

```json
{
  "format": "vial-web-layout-export/1",
  "keyboard": { "name": "Simulated Corne", "uid": "5EEDC0DE00420042" },
  "hash": "sha256:3f1c…",
  "exportedAt": "2026-10-21T18:02:11Z",
  "language": "en-us",
  "layers": [
    { "index": 0, "name": "Base", "reachedBy": [] },
    { "index": 1, "name": "Sym", "reachedBy": [ { "key": "r3c4", "how": "hold", "label": "hold Space" } ] },
    { "index": 3, "name": "Num", "reachedBy": [ { "key": "r7c3", "how": "oneShot", "label": "tap the right outer thumb" } ] }
  ],
  "shiftKeys": [ { "key": "r1c4", "hand": "left", "label": "T (hold)" }, { "key": "r5c1", "hand": "right", "label": "I (hold)" },
                 { "key": "r2c0", "hand": "left", "label": "Shift" }, { "key": "r6c5", "hand": "right", "label": "Shift" } ],
  "keys": [
    { "id": "r1c4", "hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": true,
      "x": 4, "y": 1.1,
      "chars": { "0": { "tap": "t", "shift": "T", "hold": "Shift" },
                 "1": { "tap": ")" },
                 "3": { "tap": "4" } } },
    { "id": "r3c4", "hand": "left", "finger": "thumb", "row": "thumb", "reach": "rest", "home": true,
      "x": 4.5, "y": 3.2,
      "chars": { "0": { "tap": " ", "hold": "layer 1" } },
      "layerKey": { "layer": 1, "how": "hold" } }
  ]
}
```

- `hash` covers the character map only (every key's `chars` and the layer access paths), so a lesson set stays
  valid when a layer is renamed or a macro changes, and is marked **out of date** when a character moves. It doesn't
  cover `shiftKeys`: a Shift key moved or removed doesn't mark a set out of date.
- `chars.<layer>` has `tap`, and `shift` / `altGr` when those differ; a key with no printable result on a layer is
  left out of that layer. `hold` is a short label for what holding does (`"Shift"`, `"Ctrl"`, `"layer 2"`). A plain
  AltGr key (`KC_RALT`) types nothing but has `"0": { "hold": "AltGr" }`, so the picture can light it for an `altGr`
  character.
- Transparent keys are resolved: a layer-1 entry shows what the key does *when layer 1 is on*.
- `x`, `y` are the key's centre in key units, for the generator's own sanity checks only.
- The export, and so the hash, is made in the app's keyboard language (`language`): the legends differ between
  `en-us` and `polish-qwerty`. The app sends its one keyboard language with every Learning request, so a lesson
  set's hash is compared in the language it was exported in; switching the keyboard language marks the sets out
  of date until it is switched back.

### 2.3 `fingers.json`

The user's corrections, applied on top of the app's proposal before export:

```json
{ "format": "vial-web-fingers/1",
  "keys": { "r0c5": { "finger": "index", "reach": "inner" }, "r1c0": { "finger": "pinky", "reach": "outer" } },
  "home": [ "r1c1", "r1c2", "r1c3", "r1c4", "r5c1", "r5c2", "r5c3", "r5c4", "r3c4", "r7c4" ] }
```

## 3. The lesson set

```json
{
  "format": "vial-web-lessons/1",
  "id": "corne-sim-en",
  "title": "Simulated Corne — English",
  "language": "en",
  "layout": { "name": "Simulated Corne", "uid": "5EEDC0DE00420042", "hash": "sha256:3f1c…" },
  "generatedBy": { "tool": "claude-code", "model": "claude-fable-5-1", "at": "2026-10-21T18:10:00Z" },
  "notes": "Combo K+Y gives Esc; not drilled.",
  "lessons": [
    {
      "id": "01",
      "title": "New keys: Home row",
      "new": [ { "char": "s", "key": "r1c1", "layer": 0, "via": "tap" },
               { "char": "h", "key": "r1c2", "layer": 0, "via": "tap" } ],
      "guidance": "Rest the left fingers on S H N T and the right on A E O I. Tap the keys: holding them gives a layer or a modifier.",
      "exercises": [
        { "id": "01-n1", "kind": "new-keys", "title": "New key exercise 1",
          "lines": [ "sa sa he he sa sa he he", "nt nt oi oi nt nt oi oi" ] },
        { "id": "01-w1", "kind": "words", "title": "Word exercise",
          "lines": [ "this that then than", "note tone stone seat" ] }
      ]
    }
  ]
}
```

Fields:

| Field | Rules |
|---|---|
| `id` | file name without `.json`; letters, digits, `-`, `_` |
| `language` | BCP-47 primary tag (`en`, `pl`) |
| `layout.hash` | copied from the export; the app compares it with the current keyboard |
| `lessons[].id` | unique in the set; shown in progress files; `"01"`, `"02"`, … |
| `lessons[].new[]` | the characters this lesson introduces. `char` is one character (`" "` for space is never listed; space is always known). `key` (export key id), `layer`, `via` (`tap` / `shift` / `altGr`) say where it is; `path` is an optional label (`"hold Space"`). Capitals and digits are listed one by one. |
| `lessons[].review` | `true` for a lesson that adds nothing (All keys); then `new` may be empty |
| `lessons[].guidance` | the finger text, plain words |
| `lessons[].exercises[].kind` | `new-keys`, `keys`, `words`, `blind`, `text`, `extra-keys`, `extra-words` |
| `exercises[].lines` | the text, one screen line per entry, no trailing spaces, no tabs, no empty lines |

How the app shows each kind:

| kind | Picture | Next key lit | Typing | Lines |
|---|---|---|---|---|
| `new-keys`, `keys`, `extra-keys` | shown | yes | character by character; a space ends the group; Backspace inside the current group only | joined by one space, wrapped |
| `words`, `extra-words` | shown | no | character by character; a space ends the word; Backspace inside the current word only | joined by one space, wrapped |
| `blind` | **hidden** | no | as `words` | as `words` |
| `text` | shown | no | as `words`; Enter ends a line | one under another |

A wrong key counts one error and the position stays until the right key is typed; every wrong press counts, so
`errors` can exceed the number of characters.

Known characters at lesson *n* = space + the `new` characters of lessons 1…n. Every character in every line of
lesson *n* must be known at *n*; the checker enforces it. A file holding only some lessons of a course (a batch
being written) is checked with `--course <whole course>.json`: the known characters before its first lesson come
from that file's earlier lessons. The checker also warns when an exercise is outside its
size range, when a `new-keys` exercise has under 40 % new characters, when a group isn't doubled, and when a
`new` key doesn't exist in the export or doesn't type that character (when the export is given).

## 4. Progress

```json
{
  "format": "vial-web-progress/1",
  "lessonSet": "corne-sim-en",
  "layoutHash": "sha256:3f1c…",
  "exercises": {
    "01-n1": {
      "done": true,
      "best": { "at": "2026-10-22T07:40:12Z", "chars": 228, "errors": 3, "accuracy": 98.7, "wpm": 31.2, "seconds": 88 },
      "attempts": [ { "at": "2026-10-22T07:40:12Z", "chars": 228, "errors": 3, "accuracy": 98.7, "wpm": 31.2, "seconds": 88 } ]
    }
  }
}
```

- An attempt is recorded when the exercise is typed to the end (abandoned attempts are not kept).
- `errors` = wrong keys pressed (a corrected mistake still counts one error; more errors than characters is
  possible); `accuracy` = 100 × (chars − errors) / chars, one decimal, never below 0; `wpm` = chars / 5 / minutes,
  one decimal; the server computes both from `chars`, `errors` and `seconds`. `best` is the attempt with the
  highest accuracy, then the highest WPM, **over all time**: the last 50 attempts of an exercise are kept, and the
  best stays even when it is no longer among them. `done` means there is a best.
- A lesson is **passed** when every exercise of kinds `new-keys`, `keys`, `words`, `blind`, `text` has a `best`
  with `accuracy ≥ passAccuracy`; it gets a **star** when each of those also has `wpm ≥ targetWpm`. Extras don't
  count. Nothing is locked: any lesson can be opened at any time.
- `passAccuracy` (default 95), `targetWpm` (default 30) and `pictureInWords` (default true) are the user's
  settings for the keyboard, in `settings.json` next to the `sets/` and `progress/` folders, not in the progress
  file.
- The file is per lesson set, so a regenerated set with a new `id` starts fresh and the old progress stays. A set
  imported again under the same `id` keeps its progress; entries for exercises the set no longer has are dropped
  at the next recorded attempt. A hand-edited file is read for what is valid in it.
