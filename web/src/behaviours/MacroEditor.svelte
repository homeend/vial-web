<script lang="ts">
  import { tick } from "svelte";
  import type { Described } from "../api/types";
  import Button from "../ui/Button.svelte";
  import {
    changeKind, DELAY_MAX, macroBytes, moveStep, newStep, STEP_KINDS, stepBytes, stepProblem, STEPS_MAX, type Step,
    type StepKind,
  } from "./macro";
  import { Recording, type Recorded } from "./recorder";

  interface Props {
    /** the macro's number, for the labels */
    index: number;
    /** the steps being edited: changed here */
    steps: Step[];
    vialProtocol: number;
    /** choose a key for a step (with the keycode picker): the step's index */
    onpickkey: (step: number) => void;
    /** a recorded keycode, described as the server does */
    describe: (code: string) => Promise<Described>;
    /** why it can't be saved, beyond its steps (the macro memory is full), or null */
    blocked: string | null;
    canSave: boolean;
    onsave: () => void;
    oncancel: () => void;
  }

  let { index, steps = $bindable(), vialProtocol, onpickkey, describe, blocked, canSave, onsave, oncancel }: Props =
    $props();

  let list = $state<HTMLOListElement>();
  const problems = $derived(steps.map((s) => stepProblem(s, vialProtocol)));
  const bytes = $derived(macroBytes(steps, vialProtocol));
  const kinds = $derived(STEP_KINDS.filter((k) => k.kind !== "delay" || vialProtocol >= 2));
  const tooMany = $derived(steps.length > STEPS_MAX);
  const ready = $derived(canSave && !tooMany && blocked === null && problems.every((p) => p === null));

  async function focusStep(i: number, part = "select") {
    await tick();
    list?.querySelectorAll<HTMLLIElement>(":scope > li")[i]?.querySelector<HTMLElement>(part)?.focus();
  }

  function add(kind: StepKind) {
    steps.push(newStep(kind));
    const i = steps.length - 1;
    if (kind === "tap" || kind === "down" || kind === "up") onpickkey(i);
    else void focusStep(i, "input");
  }

  function move(i: number, to: number) {
    steps = moveStep(steps, i, to);
    void focusStep(to, `button.${to < i ? "up" : "down"}`);
  }

  function remove(i: number) {
    steps.splice(i, 1);
    if (steps.length > 0) void focusStep(Math.min(i, steps.length - 1));
  }

  // recording keys typed into the browser window
  let recording = $state<Recording | null>(null);
  /** what has been recorded so far: shown while recording */
  let recorded = $state<Recorded[]>([]);
  let recordedSkipped = $state(0);
  let recordNote = $state<string | null>(null);

  function startRecording() {
    recording = new Recording();
    recorded = [];
    recordedSkipped = 0;
    recordNote = null;
  }

  async function stopRecording() {
    const done = recording;
    recording = null;
    if (!done) return;
    try {
      const made = await Promise.all(done.steps.map(async (r): Promise<Step> => r.type === "text"
        ? { type: "text", text: r.text, keys: [], delay: null }
        : { type: "tap", text: null, keys: [await describe(r.code)], delay: null }));
      steps.push(...made);
      recordNote = `${made.length} ${made.length === 1 ? "step" : "steps"} recorded` +
        (done.skipped > 0 ? `; ${done.skipped} ${done.skipped === 1 ? "key has" : "keys have"} no keycode here` : "") + ".";
    } catch {
      recordNote = "The keys recorded couldn't all be read: nothing was added.";
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      void stopRecording();
      return;
    }
    recording.keydown({ code: event.code, key: event.key, repeat: event.repeat, altGraph: event.getModifierState("AltGraph") });
    recorded = [...recording.steps];
    recordedSkipped = recording.skipped;
  }

  function onkeyup(event: KeyboardEvent) {
    if (!recording) return;
    event.preventDefault();
    recording.keyup({ code: event.code });
  }

  // while recording, every key typed into the window is the macro's (before anything else on the page sees it)
  $effect(() => {
    if (!recording) return;
    window.addEventListener("keydown", onkeydown, true);
    window.addEventListener("keyup", onkeyup, true);
    return () => {
      window.removeEventListener("keydown", onkeydown, true);
      window.removeEventListener("keyup", onkeyup, true);
    };
  });
</script>

<div class="editor">
  {#if steps.length > 0}
    <ol class="steps" bind:this={list} aria-label="Steps of macro {index}">
      {#each steps as step, i (i)}
        {@const problem = problems[i]}
        <li class="step" class:bad={problem !== null}>
          <span class="n" aria-hidden="true">{i + 1}</span>
          <select
            aria-label="Step {i + 1}: what it does"
            value={step.type}
            onchange={(e) => (steps[i] = changeKind(step, e.currentTarget.value as StepKind))}
          >
            {#each kinds as k (k.kind)}<option value={k.kind}>{k.label}</option>{/each}
          </select>
          <div class="value">
            {#if step.type === "text"}
              <input
                class="text"
                aria-label="Step {i + 1}: the text to type"
                aria-invalid={problem !== null}
                value={step.text ?? ""}
                spellcheck="false"
                autocomplete="off"
                oninput={(e) => (step.text = e.currentTarget.value)}
              />
            {:else if step.type === "delay"}
              <label class="delay">
                <input
                  type="number"
                  min="0"
                  max={DELAY_MAX}
                  step="10"
                  aria-label="Step {i + 1}: how long to wait, in ms"
                  value={step.delay ?? 0}
                  oninput={(e) => (step.delay = e.currentTarget.valueAsNumber)}
                />
                <span>ms</span>
              </label>
            {:else}
              <ul class="keys">
                {#each step.keys as key, k (k)}
                  <li>
                    <span class="key">{key.tap || key.code}</span>
                    <button type="button" class="icon" aria-label="Take {key.tap || key.code} out of step {i + 1}"
                      onclick={() => step.keys.splice(k, 1)}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                    </button>
                  </li>
                {/each}
              </ul>
              <Button size="sm" onclick={() => onpickkey(i)}>{step.keys.length === 0 ? "Choose key…" : "Add key…"}</Button>
            {/if}
          </div>
          <span class="bytes" title="Bytes of macro memory this step takes">{stepBytes(step, vialProtocol)} B</span>
          <div class="order">
            <button type="button" class="icon up" aria-label="Move step {i + 1} up" disabled={i === 0} onclick={() => move(i, i - 1)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
            </button>
            <button type="button" class="icon down" aria-label="Move step {i + 1} down" disabled={i === steps.length - 1}
              onclick={() => move(i, i + 1)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
            </button>
            <button type="button" class="icon remove" aria-label="Remove step {i + 1}" onclick={() => remove(i)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
            </button>
          </div>
          {#if problem}<p class="problem">{problem}</p>{/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="none">No steps yet: add some, or record them.</p>
  {/if}

  <div class="add" role="group" aria-label="Add a step">
    <span class="label">Add</span>
    {#each kinds as k (k.kind)}
      <Button size="sm" disabled={recording !== null} onclick={() => add(k.kind)}>{k.label}</Button>
    {/each}
    {#if recording}
      <Button size="sm" variant="primary" onclick={() => void stopRecording()}>Stop recording</Button>
    {:else}
      <Button size="sm" onclick={startRecording}>
        <span class="dot" aria-hidden="true"></span>Record from keyboard
      </Button>
    {/if}
  </div>

  {#if recording}
    <div class="recording" role="status">
      <strong>Recording: type the keys of the macro.</strong>
      <span>Esc or Stop recording ends it. Only this browser window hears them, never the keyboard itself.</span>
      {#if recorded.length > 0 || recordedSkipped > 0}
        <span class="so-far">
          {recorded.map((r) => (r.type === "text" ? `“${r.text}”` : r.code)).join(" → ")}
          {recordedSkipped > 0 ? ` (${recordedSkipped} not recorded)` : ""}
        </span>
      {/if}
    </div>
  {:else if recordNote}
    <p class="note" role="status">{recordNote}</p>
  {/if}

  <div class="foot">
    <span class="size">
      {bytes} {bytes === 1 ? "byte" : "bytes"}{tooMany ? ` · at most ${STEPS_MAX} steps` : ""}
    </span>
    {#if blocked}<span class="blocked">{blocked}</span>{/if}
    <span class="spacer"></span>
    <Button onclick={oncancel} disabled={recording !== null}>Cancel</Button>
    <Button variant="primary" disabled={!ready || recording !== null} onclick={onsave}>Save</Button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 10px;
  }

  .steps {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: grid;
    grid-template-columns: 22px 130px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--board-bg);
  }

  .step.bad {
    border-color: color-mix(in srgb, var(--warning-text) 45%, var(--border));
  }

  @media (max-width: 640px) {
    .step {
      grid-template-columns: 22px minmax(0, 1fr) auto;
    }

    .value {
      grid-column: 1 / -1;
    }
  }

  .n {
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  select,
  input {
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 13px;
  }

  .value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .text {
    flex: 1;
    width: 100%;
    font-family: var(--mono);
  }

  .delay {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
  }

  .delay input {
    width: 96px;
    font-variant-numeric: tabular-nums;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .keys li {
    display: inline-flex;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--tone-macro) 45%, var(--border));
    border-radius: 7px;
    background: color-mix(in srgb, var(--tone-macro) 10%, var(--surface));
  }

  .key {
    padding: 1px 2px 1px 8px;
    font-weight: 650;
  }

  .bytes {
    color: var(--text-3);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .order {
    display: flex;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .icon:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .icon.remove:hover:not(:disabled) {
    color: var(--danger);
  }

  .icon:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .icon svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .problem {
    grid-column: 2 / -1;
    margin: 0;
    color: var(--warning-text);
    font-size: 12px;
  }

  .none,
  .note {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .label {
    color: var(--text-3);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }

  .recording {
    display: grid;
    gap: 2px;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 9px;
    background: var(--danger-weak);
    font-size: 13px;
  }

  .so-far {
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: 12px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .size {
    color: var(--text-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .blocked {
    color: var(--danger);
    font-size: 13px;
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }
</style>
