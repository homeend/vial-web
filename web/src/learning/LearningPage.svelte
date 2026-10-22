<script lang="ts">
  import { untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Banner from "../shell/Banner.svelte";
  import FingersView from "./FingersView.svelte";
  import { learning } from "./learning.svelte";
  import LessonList from "./LessonList.svelte";
  import LessonView from "./LessonView.svelte";
  import type { Exercise, Lesson, LessonSet } from "./types";
  import TypingView from "./TypingView.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  // the store is for the keyboard shown, in the keyboard language shown (the export's characters are the language's)
  untrack(() => learning.follow(model.uid, keyboard.language));
  $effect.pre(() => learning.follow(model.uid, keyboard.language));
  // read when the page shows, once per keyboard
  $effect(() => {
    if (!learning.loaded && !learning.loading) void learning.load();
  });

  /** the view the address names: the lesson list, the Fingers view, a lesson or an exercise of a set */
  type Named = { kind: "list" } | { kind: "fingers" } | { kind: "lesson"; set: string; lesson: string }
    | { kind: "typing"; set: string; lesson: string; exercise: string };
  const path = $derived(router.route.path);
  const named = $derived.by<Named>(() => {
    if (path.length === 0) return { kind: "list" };
    if (path.length === 1) return path[0] === "fingers" ? { kind: "fingers" } : { kind: "list" };
    if (path.length === 2) return { kind: "lesson", set: path[0], lesson: path[1] };
    return { kind: "typing", set: path[0], lesson: path[1], exercise: path[2] };
  });

  /** what the address names isn't here (a set removed, a lesson of another set): said on the list */
  let note = $state<string | null>(null);

  /** the view with what it shows: null while the set it names is being read; "missing" when it names what isn't here */
  type Shown = { kind: "list" } | { kind: "fingers" } | { kind: "waiting" } | { kind: "missing"; what: string }
    | { kind: "lesson"; set: LessonSet; lesson: Lesson; number: number }
    | { kind: "typing"; set: LessonSet; lesson: Lesson; number: number; exercise: Exercise };
  const shown = $derived.by<Shown>(() => {
    if (named.kind === "list" || named.kind === "fingers") return named;
    if (!learning.loaded || learning.error) return { kind: "waiting" };
    const entry = learning.sets.find((s) => s.id === named.set);
    if (!entry) return { kind: "missing", what: `Lesson set ${named.set} isn't here.` };
    if (entry.error) return { kind: "missing", what: `Lesson set ${named.set} can't be opened: ${entry.error}` };
    const set = learning.set;
    if (learning.chosen !== named.set || !set || set.id !== named.set) return { kind: "waiting" };
    const l = set.lessons.findIndex((lesson) => lesson.id === named.lesson);
    const lesson = set.lessons[l];
    if (!lesson) return { kind: "missing", what: `Lesson ${named.lesson} isn't in ${set.title}.` };
    if (named.kind === "lesson") return { kind: "lesson", set, lesson, number: l + 1 };
    const exercise = lesson.exercises.find((e) => e.id === named.exercise);
    if (!exercise) return { kind: "missing", what: `Exercise ${named.exercise} isn't in lesson ${lesson.id} of ${set.title}.` };
    return { kind: "typing", set, lesson, number: l + 1, exercise };
  });

  // the set the address names is opened; what isn't here goes back to the list, with a note, and the address with it
  $effect(() => {
    const target = named;
    const view = shown;
    untrack(() => {
      if (path.length === 1 && target.kind === "list") {
        router.go("learning", null, { replace: true });
        return;
      }
      if (view.kind === "missing") {
        note = view.what;
        router.go("learning", null, { replace: true });
        return;
      }
      if (view.kind === "waiting" && (target.kind === "lesson" || target.kind === "typing") && learning.loaded
        && !learning.error && !learning.opening && learning.chosen !== target.set) {
        void learning.open(target.set);
      }
    });
  });

  // the note is for the list it came back to: it goes once the user goes somewhere
  $effect(() => {
    if (path.length > 0) note = null;
  });
</script>

<section class="page" class:wide={shown.kind === "typing"}>
  {#if learning.error}
    <Banner tone="danger" title="Couldn't read the lessons" message={learning.error} actionLabel="Retry"
      onaction={() => void learning.load()} />
  {/if}
  {#if shown.kind === "list"}
    <LessonList {note} onnote={(text) => (note = text)} />
  {:else if shown.kind === "fingers"}
    <FingersView {model} {placement} />
  {:else if shown.kind === "lesson"}
    <LessonView {model} {placement} set={shown.set} lesson={shown.lesson} number={shown.number} />
  {:else if shown.kind === "typing"}
    {#key `${shown.set.id}/${shown.exercise.id}`}
      <TypingView {model} {placement} set={shown.set} lesson={shown.lesson} number={shown.number} exercise={shown.exercise} />
    {/key}
  {:else if shown.kind === "waiting" && !learning.error}
    <p class="waiting" role="status">Reading the lessons…</p>
  {/if}
</section>

<style>
  /* a list page's width; the typing view takes the keymap's, for the picture and the text */
  .page {
    display: grid;
    /* one column no wider than the page: a long lesson set title shrinks to it */
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    width: 100%;
    max-width: var(--list-max);
    min-width: 0;
    margin: 0 auto;
  }

  .page.wide {
    max-width: var(--content-max);
  }

  .waiting {
    margin: 0;
    color: var(--text-2);
    font-size: 13.5px;
  }
</style>
