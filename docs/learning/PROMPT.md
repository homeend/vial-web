# Generating a lesson set with a chat LLM

_2026-10-25. The recipe for someone without Claude Code or another agent that can run programs: a chat with Claude,
ChatGPT, Gemini or any LLM that takes attached files. Everything the LLM needs is in the **generator pack** the app
offers on its Learning page (`<keyboard>-lesson-generator.zip`): this file, [GENERATE.md](GENERATE.md),
[lesson-rules.md](lesson-rules.md), [lesson-format.md](lesson-format.md),
[lesson-set.schema.json](lesson-set.schema.json), an example set (`corne-sim-en.json`, the first two lessons of a
simulated Corne) and your keyboard's `layout-export.json`, as the app exported it when the pack was downloaded._

## Steps

1. In Vial, open **Learning → Fingers…** and check which finger rests on and reaches each key; correct it where it is
   wrong (each change is saved at once). The export, and so the lessons, follow these fingers.
2. Back on **Learning**, download the **generator pack** and unzip it. (The pack holds the export of the keyboard as
   it is now; export again, or download the pack again, after a change to the fingers or the keymap.)
3. Start a new chat and attach every file of the pack. When the chat takes only a few files, these matter most, in
   this order: `layout-export.json`, `GENERATE.md`, `lesson-rules.md`, `lesson-format.md`; then the schema and the
   example.
4. Paste the prompt below and send it. Change "English" when the course is for another language.
5. The LLM shows the **course table** first: lesson 1 is the resting keys, every lesson after it adds a few keys,
   then come the capitals, the symbols, the digits and all keys together. Read it over (does it name every key you
   type with?) and say "go on", or ask for changes.
6. A full course is about 180 exercises and 80 000 characters: one reply may not hold it all. The prompt asks for
   the lessons a few at a time; when a reply is cut off, say "continue with lesson N" and join the pieces in a text
   editor so that one JSON file remains, or ask for a shorter course first (the first eight lessons, say) and the
   rest later.
7. Save the JSON as `<id>.json` (`id` is in the file's header) and import it: **Learning → Import…**.
8. Vial checks the file as the generator's checker would and refuses one that breaks the rules, listing why: paste
   the list into the chat, ask for the corrected file, import again. Warnings are shown once and the set is kept.

The set is for the layout the export described. When a character moves to another key later, the lesson list says
"Built for another layout": **Re-fit to this layout** moves the lessons' keys along; a new key or a new character
needs the course generated again.

## The prompt

```text
You write a touch-typing course for my keyboard. Attached: layout-export.json (my keyboard: every key, what it
types on each layer, the finger that types it), GENERATE.md (the instructions), lesson-rules.md (how to choose and
order the lessons and what each exercise holds), lesson-format.md and lesson-set.schema.json (the output file),
corne-sim-en.json (an example of the output, for another keyboard).

Follow GENERATE.md step by step. Course language: English. You cannot run check_lessons.py (step 6): check the
rules yourself against lesson-rules.md and the schema; the app checks the file when I import it, and I will paste
back what it reports.

Start with steps 1 and 2: list the teachable characters, then show me the course table, and wait for my go-ahead
before writing any exercise. Then write the lessons four at a time, each batch as the complete JSON of those
lessons. When all are written, give the complete lesson set as one JSON code block with nothing else in it; if it
will not fit one reply, say so and give it in parts I can join.
```
