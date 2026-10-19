<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "../api/api";
  import { ApiError } from "../api/errors";
  import type { Described, Layer } from "../api/types";
  import Button from "../ui/Button.svelte";
  import { holdExpression, holdLayerCount, holdOf, MODS, type Hold, type Mod } from "./hold";

  interface Props {
    /** the key's current action */
    current: Described;
    /** the keycode it types when tapped */
    tap: string;
    layers: Layer[];
    disabled: boolean;
    /** a change is being saved: Apply keeps the focus, but takes nothing until it is done */
    busy?: boolean;
    onapply: (code: string) => void;
    oncancel: () => void;
  }

  let { current, tap, layers, disabled, busy = false, onapply, oncancel }: Props = $props();

  // the form starts from the key's hold action; it is remade for another key
  const initial = untrack(() => holdOf(current));
  const firstOtherLayer = untrack(() => Math.min(1, layers.length - 1));
  let type = $state<"layer" | "mods" | "none">(initial?.type ?? "layer");
  let layer = $state(initial?.type === "layer" ? initial.layer : firstOtherLayer);
  let mods = $state<Mod[]>(initial?.type === "mods" ? initial.mods : ["SFT"]);
  let right = $state(initial?.type === "mods" ? initial.right : false);

  const holdLayers = $derived(layers.filter((l) => l.index < holdLayerCount(layers.length)));

  const hold = $derived<Hold>(
    type === "layer" ? { type, layer } : type === "mods" ? { type, mods, right } : null,
  );
  const expression = $derived(holdExpression(tap, hold));

  /** the server's answer for an expression: what the key will do, or why it can't */
  interface Checked {
    expression: string;
    preview: Described | null;
    problem: string | null;
  }

  let checked = $state<Checked | null>(null);
  // an answer for an earlier choice is never shown as this one's, nor applied
  const answer = $derived(checked?.expression === expression ? checked : null);
  const preview = $derived(answer?.preview ?? null);
  const problem = $derived(answer?.problem ?? null);

  // the server parses the expression: it shows what the key will do, or why it can't
  $effect(() => {
    const asked = expression;
    let stale = false;
    api.parse(asked).then(
      (result) => {
        if (!stale) checked = { expression: asked, preview: result, problem: null };
      },
      (error: unknown) => {
        if (stale) return;
        const problem = error instanceof ApiError ? error.message : "Can't check this keycode.";
        checked = { expression: asked, preview: null, problem };
      },
    );
    return () => (stale = true);
  });

  function apply() {
    if (preview && !disabled && !busy) onapply(preview.code);
  }

  function toggle(mod: Mod) {
    mods = mods.includes(mod) ? mods.filter((m) => m !== mod) : MODS.map((m) => m.mod).filter((m) => m === mod || mods.includes(m));
  }
</script>

<form
  id="hold-editor"
  class="hold-editor"
  aria-label="Change hold action"
  onsubmit={(e) => {
    e.preventDefault();
    apply();
  }}
>
  <fieldset class="choice">
    <legend>When held</legend>
    <label><input type="radio" bind:group={type} value="layer" /> Switch to a layer</label>
    <label><input type="radio" bind:group={type} value="mods" /> Hold modifiers</label>
    <label><input type="radio" bind:group={type} value="none" /> Nothing (tap only)</label>
  </fieldset>

  {#if type === "layer"}
    <label class="field">
      <span>Layer</span>
      <select bind:value={layer}>
        {#each holdLayers as l (l.index)}
          <option value={l.index}>{l.index} · {l.name}</option>
        {/each}
      </select>
    </label>
  {:else if type === "mods"}
    <div class="mods" role="group" aria-label="Modifiers">
      {#each MODS as m (m.mod)}
        <label class="mod" class:on={mods.includes(m.mod)}>
          <input type="checkbox" checked={mods.includes(m.mod)} onchange={() => toggle(m.mod)} />
          {m.label}
        </label>
      {/each}
      <label class="side"><input type="checkbox" bind:checked={right} /> right-hand</label>
    </div>
  {/if}

  <p class="result" aria-live="polite">
    <code>{expression}</code>
    {#if problem}
      <span class="problem">{problem}</span>
    {:else if preview}
      <span>→ tap {preview.tap}{preview.hold ? `, hold ${preview.hold}` : ""}</span>
    {:else}
      <span class="checking">checking…</span>
    {/if}
  </p>

  <div class="buttons">
    <Button variant="primary" size="sm" type="submit" disabled={disabled || !preview} aria-disabled={busy || undefined}>
      Apply
    </Button>
    <Button variant="ghost" size="sm" onclick={oncancel}>Cancel</Button>
  </div>
</form>

<style>
  .hold-editor {
    display: grid;
    gap: 10px;
    margin-top: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
  }

  .choice {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 4px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
  }

  .field {
    display: grid;
    gap: 4px;
    color: var(--text-2);
    font-size: 12px;
  }

  select {
    padding: 5px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
  }

  .mods {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mod {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 12px;
    cursor: pointer;
  }

  .mod.on {
    border-color: var(--tone-mod);
    background: color-mix(in srgb, var(--tone-mod) 15%, var(--surface));
  }

  .mod input {
    margin: 0;
  }

  .side {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-2);
    font-size: 12px;
  }

  .result {
    display: grid;
    gap: 2px;
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }

  .problem {
    color: var(--danger);
  }

  .checking {
    color: var(--text-3);
  }

  .buttons {
    display: flex;
    gap: 6px;
  }
</style>
