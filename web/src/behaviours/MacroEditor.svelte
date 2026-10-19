<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Described } from "../api/types";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import {
    changeKind, macroBytes, moveStep, newStep, parseDelay, STEP_KINDS, stepBytes, stepProblem, STEPS_MAX, type Step,
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
    /** a change is being saved: the controls keep the focus, but the steps take no change until it is done (a change
     * made meanwhile would be lost when the save closes the editor) */
    busy: boolean;
    onsave: () => void;
    oncancel: () => void;
  }

  let {
    index, steps = $bindable(), vialProtocol, onpickkey, describe, blocked, canSave, busy, onsave, oncancel,
  }: Props = $props();

  let list = $state<HTMLOListElement>();
  let addGroup = $state<HTMLDivElement>();
  const problems = $derived(steps.map((s) => stepProblem(s, vialProtocol)));
  const bytes = $derived(macroBytes(steps, vialProtocol));
  const kinds = $derived(STEP_KINDS.filter((k) => k.kind !== "delay" || vialProtocol >= 2));
  const tooMany = $derived(steps.length > STEPS_MAX);

  // recording keys typed into the browser window
  let recording = $state<Recording | null>(null);
  /** the recording ended, and its keys are being described: the steps come once they are */
  let finishing = $state(false);
  /** keys are being recorded (or the recorded ones described): the other controls take nothing meanwhile */
  const recordingNow = $derived(recording !== null || finishing);
  /** the steps take no change */
  const locked = $derived(busy || recordingNow);
  const ready = $derived(canSave && !tooMany && blocked === null && !recordingNow && problems.every((p) => p === null));

  /** Focuses, in step i's row, the first of the parts that is there and enabled; with no step left, the first Add
   * button */
  async function focusStep(i: number, ...parts: string[]) {
    await tick();
    const row = list?.querySelectorAll<HTMLLIElement>(":scope > li")[i];
    if (!row) {
      addGroup?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      return;
    }
    for (const part of parts) {
      const element = row.querySelector<HTMLElement>(`${part}:not(:disabled)`);
      if (element) {
        element.focus();
        return;
      }
    }
  }

  function add(kind: StepKind) {
    if (locked) return;
    steps.push(newStep(kind));
    const i = steps.length - 1;
    if (kind === "tap" || kind === "down" || kind === "up") onpickkey(i);
    else void focusStep(i, "input");
  }

  function pickKey(i: number) {
    if (!locked) onpickkey(i);
  }

  function changeStep(i: number, select: HTMLSelectElement) {
    const step = steps[i];
    if (!step) return;
    // taking no change: the select shows the kind the step still is
    if (locked) select.value = step.type;
    else steps[i] = changeKind(step, select.value as StepKind);
  }

  /** Moves a step. The focus follows it, on the arrow used, or (at the first or last place, where that arrow is
   * disabled) the other one */
  function move(i: number, to: number) {
    if (locked) return;
    steps = moveStep(steps, i, to);
    const [used, other] = to < i ? ["up", "down"] : ["down", "up"];
    void focusStep(to, `button.${used}`, `button.${other}`, "select");
  }

  /** Removes a step: the focus goes to the step now in its place, or the one before, or (none is left) Add */
  function remove(i: number) {
    if (locked) return;
    steps.splice(i, 1);
    void focusStep(Math.min(i, steps.length - 1), "button.remove", "select");
  }

  /** Takes a key out of a step: the focus goes to the key now in its place, or to Add key… */
  async function removeKey(i: number, k: number) {
    if (locked) return;
    steps[i]?.keys.splice(k, 1);
    await tick();
    const row = list?.querySelectorAll<HTMLLIElement>(":scope > li")[i];
    (row?.querySelectorAll<HTMLElement>(".keys button")[k] ?? row?.querySelector<HTMLElement>("button.pick"))?.focus();
  }

  // a wait as typed, kept as it is while it is no number of ms ("", "-", "1.5"): the field never changes under the
  // typing, and the step's problem says what is wrong
  const delayTexts = new WeakMap<Step, string>();

  function delayText(step: Step): string {
    return delayTexts.get(step) ?? String(step.delay ?? 0);
  }

  function typeDelay(step: Step, input: HTMLInputElement) {
    if (locked) {
      input.value = delayText(step);
      return;
    }
    delayTexts.set(step, input.value);
    step.delay = parseDelay(input.value);
  }

  /** what has been recorded so far: shown while recording */
  let recorded = $state<Recorded[]>([]);
  let recordedSkipped = $state(0);
  let recordNote = $state<string | null>(null);

  /** Record from keyboard and Stop recording: one button, which keeps the focus */
  function toggleRecording() {
    if (busy || finishing || keyboard.unlock.open) return;
    if (recording) {
      void stopRecording();
      return;
    }
    recording = new Recording();
    recorded = [];
    recordedSkipped = 0;
    recordNote = null;
  }

  /** `why`: said first, when the recording was stopped for the user rather than by them */
  async function stopRecording(why = "") {
    const done = recording;
    if (!done) return;
    recording = null;
    finishing = true;
    try {
      const made = await Promise.all(done.steps.map(async (r): Promise<Step> => r.type === "text"
        ? { type: "text", text: r.text, keys: [], delay: null }
        : { type: "tap", text: null, keys: [await describe(r.code)], delay: null }));
      steps.push(...made);
      recordNote = `${why}${made.length} ${made.length === 1 ? "step" : "steps"} recorded` +
        (done.skipped > 0 ? `; ${done.skipped} ${done.skipped === 1 ? "key has" : "keys have"} no keycode here` : "") + ".";
    } catch {
      recordNote = `${why}The keys recorded couldn't all be read: nothing was added.`;
    } finally {
      finishing = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (!recording || keyboard.unlock.open) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      void stopRecording();
      return;
    }
    recording.keydown({
      code: event.code, key: event.key, repeat: event.repeat, altGraph: event.getModifierState("AltGraph"),
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      capsLock: event.getModifierState("CapsLock"),
    });
    recorded = [...recording.steps];
    recordedSkipped = recording.skipped;
  }

  function onkeyup(event: KeyboardEvent) {
    if (!recording || keyboard.unlock.open) return;
    event.preventDefault();
    recording.keyup({ code: event.code });
  }

  /** The window lost the focus (Alt+Tab, another tab): it won't see the modifiers held be let go */
  function forgetHeld() {
    recording?.releaseAll();
  }

  // The unlock dialog takes every key while it shows: the keyboard's unlock keys, held on the keyboard in use, type
  // into this page and are no part of the macro. Recording stops when it opens; until then (and for any key on its way)
  // the keys are left to the dialog, whose listeners come after these ones.
  $effect(() => {
    if (recording && keyboard.unlock.open) {
      untrack(() => void stopRecording("Recording stopped for the unlock, whose keys type into this page. "));
    }
  });

  // while recording, every key typed into the window is the macro's (before anything else on the page sees it)
  $effect(() => {
    if (!recording) return;
    window.addEventListener("keydown", onkeydown, true);
    window.addEventListener("keyup", onkeyup, true);
    window.addEventListener("blur", forgetHeld);
    document.addEventListener("visibilitychange", forgetHeld);
    return () => {
      window.removeEventListener("keydown", onkeydown, true);
      window.removeEventListener("keyup", onkeyup, true);
      window.removeEventListener("blur", forgetHeld);
      document.removeEventListener("visibilitychange", forgetHeld);
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
            disabled={recordingNow}
            aria-disabled={busy || undefined}
            onchange={(e) => changeStep(i, e.currentTarget)}
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
                disabled={recordingNow}
                readonly={busy}
                oninput={(e) => {
                  if (locked) e.currentTarget.value = step.text ?? "";
                  else step.text = e.currentTarget.value;
                }}
              />
            {:else if step.type === "delay"}
              <label class="delay">
                <input
                  inputmode="numeric"
                  aria-label="Step {i + 1}: how long to wait, in ms"
                  aria-invalid={problem !== null}
                  value={delayText(step)}
                  autocomplete="off"
                  disabled={recordingNow}
                  readonly={busy}
                  oninput={(e) => typeDelay(step, e.currentTarget)}
                />
                <span>ms</span>
              </label>
            {:else}
              <ul class="keys">
                {#each step.keys as key, k (k)}
                  <li>
                    <span class="key">{key.tap || key.code}</span>
                    <button type="button" class="icon" aria-label="Take {key.tap || key.code} out of step {i + 1}"
                      disabled={recordingNow} aria-disabled={busy || undefined} onclick={() => void removeKey(i, k)}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                    </button>
                  </li>
                {/each}
              </ul>
              <Button size="sm" class="pick" disabled={recordingNow} aria-disabled={busy || undefined}
                onclick={() => pickKey(i)}>{step.keys.length === 0 ? "Choose key…" : "Add key…"}</Button>
            {/if}
          </div>
          <span class="bytes" title="Bytes of macro memory this step takes">{stepBytes(step, vialProtocol)} B</span>
          <div class="order">
            <button type="button" class="icon up" aria-label="Move step {i + 1} up" disabled={i === 0 || recordingNow}
              aria-disabled={busy || undefined} onclick={() => move(i, i - 1)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
            </button>
            <button type="button" class="icon down" aria-label="Move step {i + 1} down"
              disabled={i === steps.length - 1 || recordingNow} aria-disabled={busy || undefined}
              onclick={() => move(i, i + 1)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
            </button>
            <button type="button" class="icon remove" aria-label="Remove step {i + 1}" disabled={recordingNow}
              aria-disabled={busy || undefined} onclick={() => remove(i)}>
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

  <div class="add" role="group" aria-label="Add a step" bind:this={addGroup}>
    <span class="label">Add</span>
    {#each kinds as k (k.kind)}
      <Button size="sm" disabled={recordingNow} aria-disabled={busy || undefined} onclick={() => add(k.kind)}>
        {k.label}
      </Button>
    {/each}
    <Button size="sm" variant={recording ? "primary" : "secondary"} aria-disabled={busy || finishing || undefined}
      onclick={toggleRecording}>
      {#if recording}Stop recording{:else}<span class="dot" aria-hidden="true"></span>Record from keyboard{/if}
    </Button>
  </div>

  {#if recording}
    <div class="recording" role="status">
      <strong>Recording: type the keys of the macro.</strong>
      <span>
        Esc or Stop recording ends it, so Esc itself can't be recorded. Only this browser window hears the keys, never
        the keyboard itself, and the browser keeps some shortcuts for itself (Ctrl+W, Ctrl+T, Ctrl+N and Ctrl+Tab among
        them, in Firefox and Chromium alike): those can't be recorded.
      </span>
      {#if recorded.length > 0 || recordedSkipped > 0}
        <span class="so-far">
          {recorded.map((r) => (r.type === "text" ? `“${r.text}”` : r.code)).join(" → ")}
          {recordedSkipped > 0 ? ` (${recordedSkipped} not recorded)` : ""}
        </span>
      {/if}
    </div>
  {:else if finishing}
    <p class="note" role="status">Reading the keys recorded…</p>
  {:else if recordNote}
    <p class="note" role="status">{recordNote}</p>
  {/if}

  <div class="foot">
    <span class="size">
      {bytes} {bytes === 1 ? "byte" : "bytes"}{tooMany ? ` · at most ${STEPS_MAX} steps` : ""}
    </span>
    {#if blocked}<span class="blocked">{blocked}</span>{/if}
    <span class="spacer"></span>
    <Button disabled={recordingNow} aria-disabled={busy || undefined} onclick={oncancel}>Cancel</Button>
    <Button variant="primary" disabled={!ready} aria-disabled={busy || undefined} onclick={() => ready && onsave()}>
      Save
    </Button>
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

  /* narrow: the number, the kind, its bytes and the arrows on a line, what it types or taps on the next */
  @media (max-width: 640px) {
    .step {
      grid-template-columns: 22px minmax(0, 1fr) auto auto;
    }

    .value {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .problem {
      grid-row: 3;
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
    white-space: nowrap;
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

  /* enabled, keeping the focus, but taking nothing while a change is saved */
  .icon[aria-disabled="true"]:not(:disabled),
  select[aria-disabled="true"],
  input:read-only {
    cursor: progress;
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

  /* a long macro's editor reaches below the window: its size, Save and Cancel stay in sight at the window's bottom */
  .foot {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 -16px;
    padding: 8px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface);
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
