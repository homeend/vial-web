<script lang="ts">
  import { api } from "../api/api";
  import { ApiError } from "../api/errors";
  import type { Described } from "../api/types";
  import Button from "../ui/Button.svelte";
  import { isUnfinished } from "./template";

  interface Props {
    /** the expression typed so far; a template click fills it in */
    value: string;
    /** the keycode, and what it is */
    onpick: (code: string, described: Described) => void;
  }

  let { value = $bindable(), onpick }: Props = $props();

  const DEBOUNCE_MS = 250;

  let result = $state<Described | null>(null);
  let problem = $state<string | null>(null);
  let checking = $state(false);
  /** a template not filled in yet, e.g. "LSFT(KC_)": nothing to check */
  let unfinished = $state(false);

  // ask the server what the expression means, once typing pauses
  $effect(() => {
    const expression = value.trim();
    result = null;
    problem = null;
    unfinished = isUnfinished(expression);
    if (!expression || unfinished) {
      checking = false;
      return;
    }
    checking = true;
    let stale = false;
    const timer = setTimeout(() => {
      api.parse(expression).then(
        (parsed) => {
          if (stale) return;
          result = parsed;
          checking = false;
        },
        (error: unknown) => {
          if (stale) return;
          problem = error instanceof ApiError ? error.message : "Can't check this keycode.";
          checking = false;
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (result) onpick(result.code, result);
  }
</script>

<form class="any" onsubmit={submit}>
  <label for="any-keycode">Any keycode</label>
  <div class="row">
    <input
      id="any-keycode"
      bind:value
      autocomplete="off"
      spellcheck="false"
      placeholder="e.g. LT(1, KC_SPC) or LCTL(KC_C)"
      aria-describedby="any-keycode-result"
    />
    <Button variant="primary" type="submit" disabled={!result}>Use</Button>
  </div>
  <p id="any-keycode-result" class="result" aria-live="polite">
    {#if problem}
      <span class="problem">{problem}</span>
    {:else if result}
      <code>{result.code}</code>
      <span>tap {result.tap || "nothing"}{result.hold ? `, hold ${result.hold}` : ""}</span>
    {:else if unfinished}
      <span class="muted">Finish the keycode inside, e.g. LSFT(KC_A); it is checked once complete.</span>
    {:else if checking}
      <span class="muted">Checking…</span>
    {:else}
      <span class="muted">Type a QMK keycode expression; it is checked as you type.</span>
    {/if}
  </p>
</form>

<style>
  .any {
    display: grid;
    gap: 6px;
  }

  label {
    font-size: 12px;
    font-weight: 650;
    color: var(--text-2);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    font-family: var(--mono);
    font-size: 13px;
  }

  .result {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 20px;
    margin: 0;
    font-size: 13px;
  }

  .problem {
    color: var(--danger);
  }

  .muted {
    color: var(--text-3);
  }
</style>
