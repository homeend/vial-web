# ANSI 60 % US QWERTY: the English course for tests

Files

- `../ansi-60-en.json`: the lesson set (18 lessons, 177 exercises; checker 0 errors, 0 warnings)
- `../ansi-60-layout-export.json`: the layout export it was generated from (hash `sha256:895407b9cb17312f`)
- `vial.json`: the simulated board's definition (the test suite's ANSI 60 %)
- `ansi-60.vil`: its layout: US QWERTY on layer 0, nothing on layer 1

## Try it without a real keyboard

From the repository root:

```
Vial.exe --fake --definition docs/learning/examples/ansi-60/vial.json --layers 2 --layout docs/learning/examples/ansi-60/ansi-60.vil
```

(or `python src/main/python/vial_web.py` with the same options). Then Learning, Lesson set, Import, pick
`docs/learning/examples/ansi-60-en.json`. The set opens with no "Built for another layout" banner: the simulated
board exports the hash the set was made for.

## On a real US QWERTY Vial keyboard

Import the same file. The banner "Built for another layout" appears (another uid and hash); click "Re-fit to
this layout" and every lesson's keys follow your board. A character the board can't type (none on a plain
60 % / TKL / full-size US layout) would be listed instead.

## The course

Scenario A of `docs/learning/lesson-rules.md`, plus the shifted number row after the digits:

| Lesson | New keys |
|---|---|
| 01 | `a s d f j k l ;` |
| 02 | `e i` |
| 03 | `r u` |
| 04 | `w o` |
| 05 | `c n` |
| 06 | `, .` |
| 07 | Capital letters |
| 08 | `v m` |
| 09 | `t y` |
| 10 | `g h ' "` |
| 11 | `q p` |
| 12 | `x b` |
| 13 | `z / ? : < >` |
| 14 | `- _ = + [ { ] } \ \|` |
| 15 | Numbers |
| 16 | `~ ! @ # $ % ^` |
| 17 | `& * ( )` |
| 18 | All keys (review) |

Check it: `python util/learning/check_lessons.py docs/learning/examples/ansi-60-en.json --layout docs/learning/examples/ansi-60-layout-export.json`.
