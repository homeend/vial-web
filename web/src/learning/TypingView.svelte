<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { router } from "../lib/router.svelte";
  import Button from "../ui/Button.svelte";
  import Board from "./Board.svelte";
  import { createEngine, press, progressOf, resultOf, segments, type EngineState, type Result } from "./engine";
  import { passText, resultLines, statusText } from "./format";
  import { keyOf, typesKey } from "./keys";
  import { learning } from "./learning.svelte";
  import { nextKeyLabel, pictureFor } from "./picture";
  import { exerciseResult, nextExercise } from "./state";
  import type { Exercise, ExerciseKind, Lesson, LessonSet } from "./types";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    set: LessonSet;
    lesson: Lesson;
    /** the lesson's number in the set, from 1 */
    number: number;
    exercise: Exercise;
  }

  let { model, placement, set, lesson, number, exercise }: Props = $props();

  /** the kinds whose next key is lit, the rest faded (lesson-format.md section 3) */
  const LIT: readonly ExerciseKind[] = ["new-keys", "keys", "extra-keys"];
  /** the kinds the "picture in word exercises" setting is about */
  const WORDS: readonly ExerciseKind[] = ["words", "extra-words", "text"];

  // the page keys this view by the exercise: another exercise is another view, with an engine of its own
  let engine = $state.raw<EngineState>(untrack(() => createEngine(exercise)));
  /** the clock, for the status line: the last press, or the ticker's second */
  let now = $state(0);
  let area = $state<HTMLDivElement>();
  let text = $state<HTMLDivElement>();
  /** the finished exercise's result, and whether it was saved */
  let result = $state.raw<Result | null>(null);
  let saving = $state<"saving" | "saved" | "failed" | null>(null);
  /** saves started: only the latest one's answer sets `saving` (Again during a save starts a run of its own) */
  let saves = 0;

  const kind = $derived(exercise.kind);
  const lit = $derived(LIT.includes(kind));
  const pictureShown = $derived(kind !== "blind" && !(WORDS.includes(kind) && !learning.settings.pictureInWords));
  const layout = $derived(learning.export);
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model)));
  const nextChar = $derived(engine.done ? null : engine.expected[engine.position]);
  const picture = $derived(layout && lit && nextChar !== null
    ? pictureFor(nextChar, learning.places, placement, layout, { fadeOthers: true })
    : null);
  const nextPlace = $derived(nextChar === null ? undefined : learning.places.get(nextChar));
  const nextLabel = $derived(layout && lit && nextPlace ? nextKeyLabel(nextPlace, layout) : null);
  const runs = $derived(segments(engine));
  const progress = $derived(progressOf(engine, now));
  const next = $derived(nextExercise(set, lesson.id, exercise.id));
  const verdict = $derived(result ? exerciseResult(result, learning.settings) : null);
  /** the heading, from the files' titles: cut short with a tooltip */
  const title = $derived(`${number} · ${lesson.title} · ${exercise.title}`);

  // a second at a time while the clock runs
  $effect(() => {
    if (engine.startedAt === null || engine.done) return;
    const timer = setInterval(() => (now = performance.now()), 1000);
    return () => clearInterval(timer);
  });

  // the line being typed stays in view (six lines show at a time)
  $effect(() => {
    void engine.position;
    void engine.wrongNow;
    void tick().then(() => text?.querySelector(".next, .wrong")?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });

  onMount(() => area?.focus());

  // keys.ts says what a key means. A dead key arrives as "Dead", then the composed character on the next keydown
  // (current Chromium and Firefox on Windows); IME composition ("Process") isn't supported.
  function onkeydown(event: KeyboardEvent) {
    const key = keyOf(event);
    if (key === "quit") {
      event.preventDefault();
      quit();
      return;
    }
    // a shortcut of the browser's (Ctrl+R) stays one, and a named key keeps its work (Tab moves the focus)
    if (key === "shortcut" || key === "ignore") {
      // auto-repeat is ignored: a drill never needs it, and a key held down is one press, one error at most; a held
      // Space would scroll the page, so a typing key's repeats are swallowed
      if (event.repeat && typesKey(event.key)) event.preventDefault();
      return;
    }
    event.preventDefault();
    // the area keeps the focus after the last character (a key typed late does nothing, and Escape still quits)
    if (engine.done) return;
    const at = performance.now();
    now = at;
    engine = press(engine, key, at);
    if (engine.done) finish(engine);
  }

  function finish(state: EngineState) {
    const done = resultOf(state);
    result = done;
    void save(state, done);
  }

  /** the attempt goes to the server at once; the time as it was, not rounded to whole seconds, as the server takes
   * some time (a bot typing in under half a second is still an attempt) */
  async function save(state: EngineState, done: Result) {
    const n = ++saves;
    saving = "saving";
    const ms = (state.finishedAt ?? 0) - (state.startedAt ?? 0);
    const ok = await learning.recordAttempt(exercise.id, {
      at: new Date().toISOString(), chars: done.chars, errors: done.errors, seconds: Math.max(ms / 1000, 0.001),
    });
    // an older save's answer (Again was pressed meanwhile) never sets the status of the run shown
    if (n === saves) saving = ok ? "saved" : "failed";
  }

  async function again() {
    saves++;
    engine = createEngine(exercise);
    result = null;
    saving = null;
    now = 0;
    await tick();
    area?.focus();
  }

  function quit() {
    router.go("learning", null, { path: [set.id, lesson.id] });
  }

  // the next exercise takes this one's place in the history: Back goes to the lesson, not to the exercise just done
  function goNext() {
    if (!next) return;
    router.go("learning", null, { path: [set.id, next.lessonId, next.exerciseId], replace: true });
  }
</script>

<div class="head">
  <!-- focusable from script: it takes the focus when the view replaces another (LearningPage, App) -->
  <h1 id="learning-title" tabindex="-1" {title}>{title}</h1>
  <Button size="sm" onclick={quit}>Back to the lesson</Button>
</div>

<!-- it takes the keys typed: the text is typed into it -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div bind:this={area} class="area" tabindex="0" role="application" aria-label="Typing area"
  aria-describedby="typing-help" onkeydown={onkeydown}>
  <p id="typing-help" class="visually-hidden">
    Type the text shown. Backspace goes back within the word. Escape leaves the exercise without saving.
  </p>
  <div bind:this={text} class="text">
    {#each runs as run, i (i)}
      {#if run.lineBreak}<span class="run {run.status} end">↵</span><br />{:else}<span class="run {run.status}">{run.text}</span>{/if}
    {/each}
  </div>
  <p class="status">
    <span>{statusText(progress)}</span>
    {#if nextLabel && !engine.done}<span class="next-key">Next: {nextLabel}</span>{/if}
    <!-- at the end the result is saved (or says it wasn't): the hint would be untrue -->
    {#if !engine.done}<span class="hint">Esc quits, nothing saved</span>{/if}
  </p>
</div>

{#if pictureShown}
  <Board>
    <Keyboard {placement} {faces} labels={[]} highlights={picture?.highlights ?? []} pressed={picture?.pressed ?? []}
      faded={picture?.faded ?? []} selected={-1} onselect={() => undefined} interactive={false} maxUnit={56} />
  </Board>
{/if}

{#if result && verdict}
  <!-- polite: the result is read out when it comes, the focus staying in the typing area -->
  <section class="result" aria-labelledby="result-title" aria-live="polite">
    <h2 id="result-title">{passText(verdict.passed, learning.settings.passAccuracy)}</h2>
    {#if verdict.star}<p class="star">★ reached the target speed</p>{/if}
    <dl>
      {#each resultLines(result) as line (line.label)}
        <div><dt>{line.label}</dt><dd>{line.value}</dd></div>
      {/each}
    </dl>
    <p class="saved" role="status">
      {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved." : saving === "failed" ? "Not saved: the message that came up says why." : ""}
    </p>
    <div class="buttons">
      <Button id="typing-again" variant="primary" onclick={() => void again()}>Again</Button>
      <!-- not disabled: a disabled button shows no tooltip in Firefox -->
      <Button aria-disabled={next === null || undefined} title={next === null ? "This is the last exercise of the set" : undefined}
        onclick={goNext}>Next exercise</Button>
      <Button onclick={quit}>Back to the lesson</Button>
    </div>
  </section>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
  }

  h1 {
    flex: 1 1 240px;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    letter-spacing: -0.01em;
  }

  h1:focus {
    outline: none;
  }

  .area {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  /* :focus, not :focus-visible: the focus is given from script after a click (Again), and the ring must show then */
  .area:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .text {
    /* six lines show at a time; the line being typed is scrolled into view */
    max-height: calc(6 * 1.65em + 8px);
    overflow-y: auto;
    padding: 4px 0;
    font-family: var(--mono);
    font-size: 20px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-3);
  }

  .run.typed {
    color: var(--text);
  }

  .run.next {
    color: var(--text);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
    background: var(--accent-weak);
  }

  .run.wrong {
    color: var(--danger);
    text-decoration: line-through;
    background: var(--danger-weak);
  }

  .run.end {
    opacity: 0.6;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .next-key {
    color: var(--text);
    font-weight: 550;
  }

  .hint {
    margin-left: auto;
    color: var(--text-3);
  }

  .result {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid var(--accent);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .star {
    margin: 0;
    color: var(--ok);
    font-weight: 550;
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    margin: 0;
  }

  dl div {
    display: flex;
    gap: 6px;
  }

  dt {
    color: var(--text-2);
  }

  dd {
    margin: 0;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }

  .saved {
    min-height: 1.3em;
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
