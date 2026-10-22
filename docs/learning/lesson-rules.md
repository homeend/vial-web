# Lessons from a layout: the rules

_2026-10-21. How to turn any keyboard layout into a typing course that follows the method in
[course-method.md](course-method.md). Written for whoever generates the lessons: a person, Claude Code with the
`generate-lessons` skill, or later the app itself. The input is the **layout export** and the output is a **lesson
set**; both formats are in [lesson-format.md](lesson-format.md)._

## 1. What the generator is given

The app exports the layout as JSON (`layout-export`). The generator never reads a `.vil` file or works out fingers
from key positions; the app does that, and the user corrects it in the UI before exporting. Per key the export says:

| Field | Meaning |
|---|---|
| `id` | `"r0c3"`: matrix row and column; what the lesson file uses to point at a key |
| `hand` | `left` / `right` |
| `finger` | `pinky` / `ring` / `middle` / `index` / `thumb` |
| `row` | `number` / `top` / `home` / `bottom` / `thumb` |
| `reach` | `rest` (a resting key), `inner` (one column towards the middle), `outer` (one column away from the middle), `up`, `down` (the key above / below the resting key of that finger); thumb keys: `rest` for the thumb's main key, else `inner` / `outer` |
| `home` | `true` for the eight (or so) resting keys |
| `chars` | per layer, what the key types: `tap` (no modifier), `shift`, `altGr`; and `hold` when holding it does something else (a modifier or a layer). A layer key types nothing on the layer it reaches (holding or tapping it there is the layer switch itself), so it has no entry for that layer |
| `layerKey` | for a key that reaches another layer: `{ "layer": 1, "how": "hold" \| "toggle" \| "oneShot" \| "switch" }` |

And per layer: its name, and the keys that reach it, as `[{ "key": "r3c4", "how": "hold", "label": "hold Space" }]`.
`shiftKeys` lists the keys that give Shift, each with its hand. `language` is the OS keyboard language used to
turn keycodes into characters (`en-us`, `pl`, …).

## 2. Fingers and zones (what the app computes, what the user may change)

The app proposes, the user confirms in **Learning → Fingers**. The rules the app uses, so that the proposal is
usually right:

- **Hands.** A split board (two groups of keys with a gap wider than one key) is split at the gap. On a single
  board the split runs between the two index-finger columns of the home row (between `g` and `h` on QWERTY).
- **Columns.** Keys are grouped into columns by their x position (centre within ±0.4 u of each other). On a
  row-stagger board the rows are shifted, so the grouping uses the standard touch-typing columns instead: in each
  letter row, count keys from the inner edge of the hand outwards: index, index, middle, ring, pinky, pinky, …
- **Fingers.** Per hand, count the home-row columns whose key types a character, from the gap outwards (a modifier
  or an arrow key in the home row is no finger's resting key). Four are the fingers index, middle, ring, pinky. Of
  five, the *extra* column is the inner end (`,`/`.` next to the gap on the Corne, `g`/`h` on a QWERTY Corne, `h`
  on a 34-key QWERTY Sweep, and `,` when neither end is a letter), unless the inner key is a letter, the outer key
  is not, and a column that types nothing lies nearer the gap (`Ctrl n e i o '` on a Corne: the hand rests one
  column in, and the outer `'` is the extra); of six or more, the innermost is the extra one and
  the four after it the fingers. The extra inner column, and any column nearer the gap, is the index finger's inner
  reach (`t`/`y`, `g`/`h`, `b`/`n` on QWERTY); columns beyond the pinky are the pinky's outer reach. Keys below the
  bottom row that are set in towards the middle (a thumb cluster) are thumbs; on a plain board the space bar is the
  thumb.
- **Rows.** The three rows with the most letters on layer 0 are `top`, `home`, `bottom`; a row above them with
  digits is `number`; the thumb cluster is `thumb`. The resting keys are the four finger columns on the home row of
  each hand (`reach: rest`, `home: true`). The thumb's resting key is the thumb key that types Space (or Enter
  on the other hand), else the widest thumb key, else the one nearest the index finger. Rotated thumb keys are
  placed by their rotated centre.
- **Reach** is computed from the resting key of the same finger: same column above → `up`, below → `down`; one
  column towards the gap → `inner`, away → `outer`; number row → `up` from the top row's finger.

Anything the user changes (a finger, a resting key) is kept with the keyboard (`learning/<uid>/fingers.json`) and
exported as if the app had computed it.

## 3. Which characters can be taught

A character is **teachable** when a key produces it. The export gives, for each (key, layer), the characters. The
generator keeps:

1. **Letters of the language** on layer 0, unshifted (`tap`). These are the course's main material.
2. **Capitals** = the same keys with Shift (any `shiftKeys` entry; the picture shows the other hand's Shift, or the
   only one). A layout without a Shift key has no capitals lesson.
3. **Punctuation and symbols** on layer 0, unshifted or shifted.
4. **Characters on other layers**, with their access path: a layer reached by *hold* means "hold X, press Y";
   *oneShot* means "tap X, then Y" (one character per tap); *toggle* / *switch* mean the layer stays on, which is
   awkward in a drill: such characters are taught in a lesson of their own with an explanation, after everything
   else.
5. **Digits**, wherever they are (number row, a layer, a numpad layer).

The generator ignores: modifiers and layer keys themselves, macros, tap dances whose tap isn't a plain character,
combos (a combo that produces a character is noted in the lesson set's `notes` but not drilled; it is faster to
learn the plain key first), transparent and no-op keys. A character reachable in two ways uses the **cheapest**
way: layer 0 before layers, `tap` before `shift`, `hold` before `oneShot`, the resting-key side of a tie.

When a layer-0 letter key also *holds* for a modifier or a layer (home-row mods, `LT(1, Space)`), the lesson's
finger text says "tap, don't hold" once; the exercises are unchanged.

## 4. Building the course

### 4.1 Lesson 1: the resting keys

Lesson 1 teaches the characters typed by the `home: true` keys (unshifted). On QWERTY that is `a s d f j k l ;`; on
the simulated Corne `s h n t a e o i`. If a resting key types no character (a modifier-only key), it is left out
and the lesson says why.

### 4.2 Pairs

Every teachable letter not in lesson 1 belongs to a **position**: (finger, row, reach). Two letters at the **same
position on both hands** form a mirrored pair, the unit of a letter lesson. A letter whose mirror position holds
no letter is a **single**; two singles with the same finger, or the same row, join into one lesson; a single that
fits nowhere goes with the nearest pair (three keys in a lesson is fine; four is the most).

### 4.3 Order

Give each lesson candidate a score:

```
score = Σ freq(letter) − Σ penalty(position)
```

`freq` is the letter's frequency in the course language, in percent (English:
e 12.7, t 9.1, a 8.2, o 7.5, i 7.0, n 6.7, s 6.3, h 6.1, r 6.0, d 4.3, l 4.0, c 2.8, u 2.8, m 2.4, w 2.4, f 2.2,
g 2.0, y 2.0, p 1.9, b 1.5, v 1.0, k 0.8, j 0.15, x 0.15, q 0.10, z 0.07).

`penalty` per key: top row 0, home row 0, bottom row 1, `inner` reach 2, pinky finger 2 (on top of the row
penalty), `outer` reach 3, a key on another layer 3 plus 2 if the layer is one-shot, a thumb key 1.

Sort the letter lessons by score, highest first. Then adjust by hand, in this order of importance:

1. **Words.** If swapping two neighbouring lessons lets the earlier lesson's word exercises use clearly more
   common words, swap them. (This is why QWERTY teaches `r u` before `w o`.)
2. **Comma and full stop** become a lesson as soon as six or more letters beyond lesson 1 are known, and no later
   than the sixth lesson. If `,` and `.` are on the same keys as letters of a later lesson (shifted), they wait for
   that lesson.
3. **Capitals** come right after the comma/full-stop lesson: by then twelve to sixteen letters are known. The
   capitals lesson lists every known letter's capital as new; a letter lesson after it lists both cases
   (`c C x X`), so a lesson set always says exactly which characters are known.
4. Lessons whose score is below 0 (rare letters, awkward positions) stay at the end, in score order.

### 4.4 After the letters

5. **Remaining layer-0 symbols**, grouped by key (unshifted + shifted together: `' "`, `/ ?`, `- _`), two to six
   characters per lesson, the common ones first (`' " - / ?` before `[ ] \`).
6. **Symbols on other layers**, grouped by layer, then by row within the layer, two to eight characters per
   lesson, the common programming symbols first (`( ) - _ = + ; :` before `[ ] { } < >` before
   `! @ # $ % ^ & * ~ \` |`). The lesson text explains the access path once ("hold Space with the left thumb").
7. **Digits**, one lesson: ten digits plus the known letters; if the digits are on a one-shot layer, the lesson says
   so and the drills use single digits between words.
8. **Everything**: one closing lesson that draws from all taught characters.
9. **Toggle / switch layers** (section 3, point 4), if any, after everything else, one lesson per layer.

A course may have more or fewer than 15 lessons; it ends when nothing teachable is left.

### 4.5 Lesson titles and finger text

The title is "New keys: " plus the new characters (`New keys: r and d`, `New keys: , and .`, `New keys: Capital
letters`, `New keys: Numbers`, `New keys: All keys`). Each lesson has a short `guidance` text (two to four
sentences) that says, for each new character: the hand, the finger, the move from the resting key ("left middle
finger, up one row"), and the access path for a layer or Shift ("hold Space with the left thumb, then …"). When a
key is also a hold key: "tap it; holding it gives Ctrl". Plain words, no key-matrix ids.

## 5. What goes into each lesson

Sizes are characters of text, spaces included. "Known" = taught in this or an earlier lesson. "New" = this
lesson's characters. Every exercise uses **known characters only**; the validator checks this.

| Exercise | Hint | Content | Size |
|---|---|---|---|
| New key exercise 1, 2 (lesson 1: 1, 2, 3) | on | Groups of 4 characters from the **new keys and the resting keys**, each group written twice: `aeil aeil siek siek`. At least 40 % of the characters are new keys; both hands in most groups; no group of one repeated character. Lesson 1 starts with 2-character alternations (`ad ad jk jk`, `sf sf k; k;`) for the first third. | 220–460 |
| Key exercise 1, 2 (lesson 1: 1, 2, 3) | on | Real words of 3–8 letters made of known characters, each written twice: `file file flea flea`. Prefer words that contain a new character. If fewer than 20 such words exist (early lessons on a sparse layout), fill with 4-character groups of known characters in lines of two. | 200–420 |
| Word exercise 1, 2 (lesson 1: 1) | off | Real words, lines of 4–6, most containing a new character, none repeated within the exercise unless unavoidable. | 450–600 |
| Blind exercise 1, 2 (none in lesson 1) | off, picture hidden | As a word exercise, other words. | 400–520 |
| Text exercise 1, 2 (none in lesson 1) | off | Before the comma/full-stop lesson: lines of 10–14 words. From the capitals lesson on: **sentences** (capital, words, full stop; commas when known), 2–4 per line. Natural English, no proper nouns unless taught, no digits or symbols unless taught. | 450–600 |
| Extra key exercise, Extra word exercise | on / off | As key exercise / word exercise, other material. Optional. | as above |

Special lessons:

- **Capital letters**: new-key groups are 4 known letters in mixed case (`rUiC rUiC`), at least one capital per
  group; key and word exercises use **capitalised words, names and acronyms** (`Finland ISO Nora`) spelled with
  known letters; text exercises are sentences.
- **Comma and full stop**: groups mix the two with known letters (`a,d. a,d.`); words carry a trailing `,` or `.`
  (`flask, salad.`); text is sentences if capitals are known, else word runs ending in a full stop.
- **A symbol lesson**: groups mix the new symbols with known letters (`r?rh r?rh`); the word exercise wraps or
  joins known words with the symbols the way they are used (`(salad) "lake" x-ray`); text exercises are sentences
  that use them.
- **Numbers**: groups of digits and letters (`a7w9 a7w9`, `8370 8370`); the word exercise is "number, its name,
  full stop" (`43 forty three.`); text exercises are sentences with numbers in them.
- **All keys**: groups drawn from everything taught (`6\8\ 6\8\`), words and sentences with symbols and digits.

Spaces separate groups and words; a line of a lesson file is one line on screen; the app joins lines with a
space (word mode) or shows them one under another (text mode), see lesson-format.md.

## 6. Scenario A — ANSI 60 %, US QWERTY, nothing on other layers

Resting keys: `a s d f` (left pinky → index), `j k l ;` (right index → pinky). Thumbs: Space.

Positions of the other letters and their scores (freq − penalty):

| Pair | Position | Score |
|---|---|---|
| e i | middle, top | 19.7 |
| w o | ring, top | 9.9 |
| r u | index, top | 8.8 |
| t y | index, inner-top | 7.1 |
| g h | index, inner-home | 4.1 |
| v m | index, bottom | 1.4 |
| c (single: `,` mirrors it) | middle, bottom | 1.8 |
| n (single: `b`'s mirror is `n`, but `b` is a rarer stretch) | index, inner-bottom | 3.7 |
| x (single: `.` mirrors it) | ring, bottom | −0.85 |
| b (single) | index, inner-bottom | −1.5 |
| q p | pinky, top | −2 |
| z (single: `/` mirrors it) | pinky, bottom | −2.9 |

Course (after the hand adjustments of 4.3): 1 `a s d f j k l ;` · 2 `e i` · 3 `r u` (swapped with `w o` for words:
`are, our, sure, …`) · 4 `w o` · 5 `c n` (two singles, same row) · 6 `, .` · 7 Capital letters · 8 `v m` · 9 `t y` ·
10 `g h ' "` (`'` is the right pinky's outer home key, joined to the home-row lesson) · 11 `q p` · 12 `x b`
(singles) · 13 `z / ? : < >` (`:` and `< >` are Shift on keys already known; `;` was a resting key) ·
14 `- _ = + [ { ] } \ |` · 15 Numbers · 16 All keys. This matches the typingstudy QWERTY list except that their
lessons 13 and 14 cut the symbols differently; both cuts are allowed by the rules.

## 7. Scenario B — the simulated Corne (`simulator/corne.py`), US English

A 3×6 + 3 split with column stagger. Layer 0 (visual order, left half then right half):

```
top     TAB  W   L   R   B   Z    |  Q   U   D   J   \   BSPC
home    CTL  S   H   N   T   ,    |  .   A   E   O   I   '
bottom  SFT  F   M   C   V   /    |  G   P   X   K   Y   SFT
thumbs           ESC SPC TD0      |  M0  ENT OSL3
```

Hold behaviour on layer 0: `S` holds layer 2, `H` Alt, `N` Ctrl, `T` Shift, `A` Gui, `E` Alt, `O` Ctrl, `I` Shift,
`B` layer 2, `W` Gui; `SPC` holds layer 1 (symbols); `OSL3` is one-shot layer 3 (digits, F-keys). Layer 1 under the
left hand: `! @ # $ %` (top), `` ` + ( ) = `` (home), `~ { } [ ]` (bottom); under the right hand: `^ & * - _`
(top), `; : " | \` (home). Layer 3: `1 2 3 4 5` on the left home row, `6 7 8 9 0` on the right.

Fingers (the app's proposal): column 0 = pinky outer, 1 = pinky, 2 = ring, 3 = middle, 4 = index, 5 = index inner;
mirrored on the right. Resting keys: `S H N T` and `A E O I`. The thumb's resting keys: `SPC` and `ENT`.
`Shift` is the home-row key `T` (left) and `I` (right), plus the two outer bottom keys.

| Pair / single | Position | Score |
|---|---|---|
| r d | middle, top | 10.3 |
| b u | index, top | 4.3 |
| l j | ring, top | 4.15 |
| m k | ring, bottom | 1.2 |
| c x | middle, bottom | 0.95 |
| v p | index, bottom | 0.9 |
| w (single: `\` mirrors it) | pinky, top | 0.4 |
| g (single: `/` mirrors it) | index, inner-bottom | −1.0 |
| f y | pinky, bottom | −1.8 |
| z q | index, inner-top | −3.8 |

Course:

| # | Lesson | Why here / guidance in one line |
|---|---|---|
| 1 | `s h n t a e o i` | The resting keys. "Tap them; holding S, H, N, T, A, E, O, I gives a layer or a modifier." |
| 2 | `r d` | Middle fingers, up one row. |
| 3 | `b u` | Index fingers, up one row. |
| 4 | `l j` | Ring fingers, up one row. |
| 5 | `, .` | Index fingers, one column inwards on the home row (six letters beyond lesson 1 are known: rule 4.3.2). |
| 6 | `m k` | Ring fingers, down one row. |
| 7 | Capital letters | "Hold the other hand's home Shift: T under the left index, I under the right pinky; or the outer bottom keys." |
| 8 | `c x` | Middle fingers, down. |
| 9 | `v p` | Index fingers, down. |
| 10 | `w g` | Two singles: left pinky up (w), right index inwards and down (g). |
| 11 | `f y` | Pinkies, down. |
| 12 | `z q` | Index fingers, inwards and up. |
| 13 | `' " / ? \ \|` | The layer-0 symbols: right pinky outer home (`'`), left index inner-bottom (`/`), right pinky top (`\`); Shift for the second of each. |
| 14 | `( ) - _ = + ; :` | Layer 1: "hold Space with the left thumb". Left home `( ) =`, right top `- _`, right home `; :`, left home `+`. |
| 15 | `[ ] { } < >` + `` ` ~ `` | Layer 1 bottom row and the rest; `< >` are Shift + `, .` on layer 0. |
| 16 | `! @ # $ % ^ & * \|` | Layer 1 top row (and `\|`). |
| 17 | Numbers | "Tap the right outer thumb (one-shot layer 3), then the digit on the home row: 1–5 left, 6–0 right. One tap per digit." |
| 18 | All keys | Everything. |

Eighteen lessons rather than fifteen: the Corne has more symbols on layers than a 60 % board has keys to drill at
once.

## 8. Scenario C — the owner's W-CORNE (read from the keyboard on 2026-10-21, read-only)

The simulated Corne was modelled on this keyboard, so B and C share the home row and most of the letters; the
differences are the top row, the thumbs, where the symbols live, and that there is only one Shift. Layer 0
(the four navigation keys in the middle and the extra right column are left out of the drawing):

```
top     Tab   Q   L   R   B   Z    |  Bksp  W   U   D   J   -
home    Meh   S   H   N   T   ,    |  .     A   E   O   I   =
bottom  Alt   F   M   C   V   /    |  G     P   X   K   Y   Esc
thumbs       Sym  Space  Shift     |  Ctrl  Enter  Fn
```

- `Q` is a tap dance (tap = Q, double tap = Win); `S` is a tap dance (tap = S, hold = layer 1, navigation);
  the bottom-left `Alt` is a tap dance (tap/hold = Alt, double tap = one-shot AltGr).
- Thumbs, from the outside in: left **Sym** = `MO(5)`, **Space**, **Shift** (the only Shift on the board);
  right **Ctrl**, **Enter** = `LT(4, Enter)` (hold = layer 4, digits), **Fn** = `OSL(3)` (shortcuts and
  macros, nothing typeable).
- Layer 5 (hold Sym) under the left hand: `~` (Tab's key), home `; ! + ( ) @`, bottom `$ # { } \`; under the
  right hand: top `" '` (U's and D's keys), home `* { } = _` and `:` on the outer column, bottom `& | % ^ -`.
- Layer 4 (hold Enter): `1 2 3 4 5` on the left home row from S to `,`, `6 7 8 9 0` on the right from `.` to I.
- Combos: `A+E+O` and `H+N+T` give a one-shot AltGr (Polish letters on a Polish OS layout); `,`+`.` gives
  Alt+Ctrl; thumb combos change the default layer. Not drilled.
- **Not typeable on this layout:** `[`, `]` and `` ` `` (only `{ }` and `~` exist). A generated course can't
  teach them; the lesson set's `notes` should say so.

Fingers: as in scenario B (column 1 = pinky … 4 = index, 5 = index inner, 0 = pinky outer; the right half
mirrored, with `-` `=` `Esc` as the pinky's outer column). Resting keys `S H N T` and `A E O I`; thumb resting
keys Space and Enter. Capitals: hold the left inner thumb for every capital, both hands.

| Pair / single | Position | Score |
|---|---|---|
| r u | middle, top | 8.8 |
| l d | ring, top | 8.3 |
| b w | index, top | 3.9 |
| m k | ring, bottom | 1.2 |
| c x | middle, bottom | 0.95 |
| v p | index, bottom | 0.9 |
| g (single; `/` mirrors it) | index, inner-bottom | −1.0 |
| z (single; Backspace mirrors it) | index, inner-top | −1.9 |
| f y | pinky, bottom | −1.8 |
| q j | pinky, top | −3.75 |

Course:

| # | Lesson | Guidance in one line |
|---|---|---|
| 1 | `s h n t a e o i` | The resting keys. "Tap S and let go: holding it switches to the navigation layer." |
| 2 | `r u` | Middle fingers, up one row. |
| 3 | `l d` | Ring fingers, up one row. |
| 4 | `b w` | Index fingers, up one row. |
| 5 | `, .` | Index fingers, one column inwards on the home row. |
| 6 | `m k` | Ring fingers, down one row. |
| 7 | Capital letters | "Hold Shift with the left thumb — the inner thumb key — for every capital, on both hands." |
| 8 | `c x` | Middle fingers, down. |
| 9 | `v p` | Index fingers, down. |
| 10 | `g z` | Right index inwards and down; left index inwards and up. |
| 11 | `f y` | Pinkies, down. |
| 12 | `q j` | Pinkies, up. "Q is a tap dance: one tap types Q; a double tap is the Win key, so tap it once and move on." |
| 13 | `/ ? < >` | Left index inwards and down; Shift for `?`; `< >` are Shift + `, .`. |
| 14 | `- _ = +` | Right pinky, outer column, top and home; Shift for the second of each. |
| 15 | `( ) ; : ' "` | Layer 5: "hold Sym with the left thumb" — `( )` left middle and index on the home row, `;` left outer home, `:` right outer home, `' "` right ring and middle on the top row. |
| 16 | `! @ # $ % ^ & *` | Layer 5: `!` left pinky home, `@` left index inner home, `# $` left ring and pinky bottom, `% ^ & *` right middle, ring, inner bottom and inner home. |
| 17 | `{ } \ \| ~` | Layer 5: `{ }` under the left middle and index on the bottom row (also on the right home row), `\` left index inner bottom, `\|` right index bottom, `~` left pinky outer top. |
| 18 | Numbers | "Hold Enter with the right thumb; the digits are on the home row: 1–5 from S to the comma, 6–0 from the full stop to I." |
| 19 | All keys | Everything. |

Nineteen lessons. `[ ] \`` are missing from the course because the layout has no key for them.

A later Polish course adds `ą ć ę ł ń ó ś ź ż` after their base letters, with the access path "press the
A E O combo (one-shot AltGr), then the letter" in the guidance; that needs the export made with `language: pl`.

## 9. Later, not now

- Polish word lists and the Polish letter frequencies (a 9.0, i 8.2, o 7.8, e 7.7, z 5.6, n 5.5, r 4.7, w 4.7,
  s 4.3, c 4.0, t 4.0, y 3.8, k 3.5, d 3.3, p 3.1, m 2.8, u 2.5, j 2.3, l 2.1, ł 1.8, b 1.5, g 1.4, ę 1.1, h 1.1,
  ą 1.0, ó 0.9, ż 0.8, ś 0.7, ć 0.4, f 0.3, ń 0.2, ź 0.06).
- Drilling the *hold* side of home-row mods (shortcuts) and combos.
- Speed tests and a free-typing mode outside the course.
