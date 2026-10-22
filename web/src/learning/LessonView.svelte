<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { router } from "../lib/router.svelte";
  import Button from "../ui/Button.svelte";
  import Board from "./Board.svelte";
  import { bestText } from "./format";
  import { learning } from "./learning.svelte";
  import { nextKeyLabel, pictureForAll } from "./picture";
  import { exerciseResult, isMain } from "./state";
  import type { Lesson, LessonSet } from "./types";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    set: LessonSet;
    lesson: Lesson;
    /** its number in the set, from 1 */
    number: number;
  }

  let { model, placement, set, lesson, number }: Props = $props();

  const layout = $derived(learning.export);
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model)));
  // a review lesson (nothing new) shows the whole board as it is, not faded
  const picture = $derived(layout
    ? pictureForAll(lesson.new.map((n) => n.char), learning.places, placement, layout,
      { fadeOthers: lesson.new.length > 0 })
    : null);
  /** the heading, from the file's title: cut short with a tooltip */
  const title = $derived(`${number} · ${lesson.title}`);
  /** each new character with the way to its key: "( — hold Sym → ("; an entry without a key (the file may leave it
   * out) shows the character alone */
  const chars = $derived(lesson.new.map((n) => {
    const place = learning.places.get(n.char) ?? (n.key ? { key: n.key, layer: n.layer ?? 0, via: n.via ?? "tap" } : null);
    return { char: n.char, how: place ? (layout ? nextKeyLabel(place, layout) : place.key) : null };
  }));
  const exercises = $derived(lesson.exercises.map((exercise) => {
    const best = learning.progress?.exercises[exercise.id]?.best ?? null;
    return { exercise, best: bestText(best), star: best ? exerciseResult(best, learning.settings).star : false,
      main: isMain(exercise) };
  }));

  function open(exerciseId: string) {
    router.go("learning", null, { path: [set.id, lesson.id, exerciseId] });
  }
</script>

<!-- PageHeader's shape, with the file-carried title cut short and a tooltip (which PageHeader's h1 can't do) -->
<header class="head">
  <div class="heading">
    <!-- focusable from script: it takes the focus when the view replaces another (LearningPage, App) -->
    <h1 id="learning-title" tabindex="-1" {title}>{title}</h1>
    <p class="guidance">{lesson.guidance}</p>
  </div>
  <Button onclick={() => router.go("learning")}>Back to lessons</Button>
</header>

{#if picture}
  <Board>
    <Keyboard {placement} {faces} labels={[]} highlights={picture.highlights} pressed={picture.pressed}
      faded={picture.faded} selected={-1} onselect={() => undefined} interactive={false} maxUnit={56} />
  </Board>
{/if}

{#if chars.length > 0}
  <ul class="chars" aria-label="New characters">
    <!-- by index: a file may list a character twice. The gap is an expression: a space at the start of the block
         would be dropped, and the text (seen or read out) is "s — S" -->
    {#each chars as c, i (i)}
      <li><kbd>{c.char === " " ? "Space" : c.char}</kbd>{#if c.how !== null}{" "}<span class="how">— {c.how}</span>{/if}</li>
    {/each}
  </ul>
{:else}
  <p class="review">A review: nothing new, every key so far.</p>
{/if}

<ol class="exercises" aria-label="Exercises">
  {#each exercises as e (e.exercise.id)}
    <li>
      <button type="button" class="exercise" onclick={() => open(e.exercise.id)}>
        <span class="kind" class:extra={!e.main}>{e.exercise.kind}</span>
        <span class="title" title={e.exercise.title}>{e.exercise.title}</span>
        <span class="best">{#if e.star}<span class="star" role="img" aria-label="reached the target speed">★</span> {/if}{e.best}</span>
      </button>
    </li>
  {/each}
</ol>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px 16px;
  }

  .heading {
    flex: 1 1 320px;
    min-width: 0;
  }

  h1 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 22px;
    letter-spacing: -0.01em;
  }

  h1:focus {
    outline: none;
  }

  .guidance {
    margin: 4px 0 0;
    color: var(--text-2);
  }

  .chars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13.5px;
  }

  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 1px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    font-family: var(--mono);
    text-align: center;
  }

  .how,
  .review {
    color: var(--text-2);
  }

  .review {
    margin: 0;
    font-size: 13.5px;
  }

  .exercises {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .exercise {
    display: grid;
    grid-template-columns: 7em minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow);
  }

  .exercise:hover {
    background: var(--surface-2);
  }

  .kind {
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 12px;
  }

  .kind.extra {
    font-style: italic;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .best {
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .star {
    color: var(--ok);
  }

  @media (max-width: 480px) {
    .exercise {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .kind {
      grid-column: 1 / -1;
    }
  }
</style>
