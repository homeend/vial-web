# How a touch-typing course is built

_2026-10-21. What the typingstudy.com course does, written down as requirements, so that the same method can be
applied to any keyboard layout (see [lesson-rules.md](lesson-rules.md)). This describes the method; no lesson text
from the site is copied._

## 1. The course at a glance

- **15 lessons**, each titled "New keys: …". Every lesson adds a few keys and drills them together with everything
  learned before. The last lessons add Shift (capitals), the symbol keys, the number row, and finally "all keys".
- A **speed test** and a **typing test** outside the course; games; a numeric keypad course. Out of scope here.
- The learner sees: the text to type, a keyboard picture with the **next key lit** in the early exercises, and live
  counters: signs (characters typed), progress, WPM, errors, accuracy, time. **WPM = characters ÷ 5 per minute**,
  spaces and punctuation included.
- The site sets **no pass threshold**. Lessons are a sequence the learner walks through; registering only adds a
  history. The advice is "one lesson a day" and accuracy before speed.
- **Backspace** only corrects inside the current word: once a space is typed the word is done and counted.
- **Capitals** are typed as Shift + letter; the picture lights the letter and the Shift of the **other hand**.

## 2. The same course on four layouts

The lesson list is the only thing that changes between layouts. The exercises are regenerated from the lesson's
key set. Comparing the lists shows the ordering rule.

| Lesson | US QWERTY | Colemak | Dvorak | Workman |
|---|---|---|---|---|
| 1 | home row | home row | home row | home row |
| 2 | e i | p l | i d | r u |
| 3 | r u | d h | p g | c l |
| 4 | w o | v m | k m | d p |
| 5 | c n | f u , . | j w , . | m , . |
| 6 | , . | Capitals | Capitals | Capitals |
| 7 | Capitals | g j | y f | g y |
| 8 | v m | y c | c x | w f |
| 9 | t y | w x | r b | b j |
| 10 | g h ' " | b k | q v | v k < > |
| 11 | q p | q ; : ' " | l ' " - _ | z x / ? |
| 12 | x b | z < > / ? | z < > / ? ; : | q ; : ' " |
| 13 | z ? : < > / | - _ = + [ { ] } \ \| | [ { ] } = + \ \| | - _ = + [ { ] } \ \| |
| 14 | Numbers | Numbers | Numbers | Numbers |
| 15 | All keys | All keys | All keys | All keys |

(UK English differs from US only in lesson 10: `'` and `@`, because `@` sits on that key.)

What the four lists have in common, by position rather than by letter:

1. **Lesson 1 is the eight resting keys** (four per hand), not the whole middle row: QWERTY `a s d f j k l ;`,
   Colemak `a r s t n e i o`. The inner-column keys of the middle row (`g h` on QWERTY) come later.
2. **Every later letter lesson adds a mirrored pair**: the same finger and the same row on both hands.
   QWERTY `e i` = both middle fingers, top row; `r u` = index fingers, top row; `v m` = index fingers, bottom row;
   `t y` = index fingers stretched inwards; `g h` = index fingers stretched inwards on the home row; `q p` = pinkies,
   top row. Colemak `p l` sit where QWERTY has `r u`; Dvorak `k m` where QWERTY has `v m`. When the letters at a
   mirrored pair aren't both worth a lesson, the pair is broken and a letter from another position joins (QWERTY
   `c n`, `x b`; Dvorak `c x`).
3. **The order of the pairs is by usefulness, not by a fixed tour of the keyboard.** The top-row pairs under the
   middle and index fingers come first on every layout; the inner stretch columns, the bottom row and the pinkies
   come later; `z`, `q`, `x` and the symbols come last. Within that, frequent letters are pulled forward: on Dvorak
   the home-row stretch `i d` is lesson 2 because `i` and `d` are frequent; on QWERTY the same positions (`g h`) wait
   until lesson 10. The practical rule: **a lesson is placed where its letters, added to what is known, unlock the
   most common words**, preferring comfortable positions.
4. **Comma and full stop** arrive around lesson 5–6, as soon as there are enough letters for sentences.
5. **Capitals (Shift)** are the sixth or seventh lesson, once about twelve to fourteen letters are known.
6. **The remaining symbols** are grouped by key: a lesson that teaches a key teaches both its unshifted and
   shifted character (`' "`, `< >`, `- _`, `[ {`). On a layout whose symbols don't share keys (a Corne with a
   symbol layer) they are grouped by layer and finger instead; see the rules document.
7. **The number row** is one lesson near the end, with its shifted symbols shown on the picture but not drilled.
8. **"All keys"** is the final mixed lesson.

## 3. Exercise types

Each lesson is a sequence of exercises. Their names, order and composition are the same in every lesson (lesson 1
is shorter). The site's page code has a numeric exercise type; the names below are the ones shown to the learner.

| # | Exercise | Picture hint | Composition (observed) |
|---|---|---|---|
| 1–2 | **New key exercise** 1, 2 (lesson 1: 1–3) | **on**: the next key is lit | Groups of four characters drawn from the **new keys plus the resting keys**, each group typed **twice** ("aeil aeil siek siek"). About half of the characters are new keys. 25–55 groups (220–460 characters). Lesson 1 starts with two-character alternations ("ad ad jk jk", "sf sf k; k;") before four-character groups, and mixes hands within a group ("ajaj sksk"). |
| 3–4 | **Key exercise** 1, 2 (lesson 1: 1–3) | on | Four-to-eight-letter **real words made only of the keys known so far**, each typed twice ("file file flea flea … selfless selfless"). When the known keys give too few words (lesson 1) the groups are random letter strings in short lines. 200–420 characters. |
| 5–6 | **Word exercise** 1, 2 (lesson 1: one) | off | **Real words**, every one spelled only with known keys, lines of 4–6 words, about 500–580 characters. The new keys appear in most words ("defied slide lake selfless"). Typed word by word: a space finishes the word. |
| 7–8 | **Blind exercise** 1, 2 (none in lesson 1) | off, **keyboard picture hidden** | The same as a word exercise, about 480 characters. |
| 9–10 | **Text exercise** 1, 2 (none in lesson 1) | off | Longer lines of about 12–13 words (about 500 characters), still only known keys. On the site they are word lists; a generator that can write sentences should (see rules). |
| extra | **Extra key exercise**, **Extra word exercise** | on / off | Optional repeats of 3 and 5 with other material. |

Lesson-specific material:

- **Capitals** (Shift): new-key groups are four letters in random case ("rUiC rUiC", "fLDa fLDa"); the word
  exercises are **proper nouns and acronyms** ("Finland Caracas … ISO NCO") made of the known letters.
- **Numbers**: new-key groups mix digits with known letters ("a7w9 a7w9", "8370 8370"); the word exercise is
  the number followed by its name and a full stop ("43 Forty Three. 85 Eighty Five.").
- **Symbols**: new-key groups mix the new symbols with known letters and capitals ("r?rh r?rh", "x/za x/za").
- **All keys**: groups drawn from everything ("6\8\ 6\8\ ~#$# ~#$#").

## 4. What the learner is told

- Which keys are new (the lesson title) and, on the picture, which key to press next.
- No written finger rules. The picture carries the finger information: the next key is lit, and for a shifted
  character the other hand's Shift is lit with it.
- Counters only. No target, no "passed", no star.

## 5. Requirements for our version

Taken over as they are:

- R1 One course = ordered lessons; each lesson = new keys + the exercise sequence of section 3, in that order,
  with the composition rules of section 3.
- R2 Lesson 1 = the resting keys; the exercise sequence of lesson 1 is shorter (3 + 3 + 1, no blind, no text).
- R3 Every exercise uses only keys known at that point in the course.
- R4 WPM = characters ÷ 5 per minute; accuracy = correct characters ÷ characters in the text; Backspace corrects
  inside the current word only.
- R5 The next key is lit on the keyboard picture in "new key" and "key" exercises; the picture is hidden in blind
  exercises.
- R6 A shifted character lights the character's key and the Shift of the other hand. On a keyboard where Shift is a
  home-row mod, it lights that key with "hold" styling.

Changed or added:

- R7 **Lessons are generated from the layout** by the rules in lesson-rules.md: resting keys, then mirrored pairs by
  usefulness, punctuation, capitals, the rest, number keys, all keys. Keys on other layers are reached by the layer
  key the layout gives them; the picture lights the layer key (hold) and then the key.
- R8 **Finger guidance in words**: each lesson says which fingers it trains ("left middle finger, up one row") —
  the site relies on the picture alone, which is not enough on a column-stagger split.
- R9 **Pass criteria**, since the site has none: an exercise counts as done when typed to the end; a lesson is
  passed when every main exercise (1–10) was finished with accuracy ≥ 95 % (the user can change the number). WPM
  is recorded, not gated; a target WPM (default 30) gives a star.
- R10 **Text exercises should be sentences** when the known keys allow (after the comma/full stop and capitals
  lessons), because sentences are what the learner wants to type. Before that, word lists as on the site.
- R11 **Progress is kept locally** per keyboard and per lesson set (format in lesson-format.md).
- R12 **Language**: English first; Polish later needs letters on AltGr or a layer, which the layout export already
  describes.
