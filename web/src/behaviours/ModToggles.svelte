<script lang="ts">
  import { MOD_NAMES, modBit, toggled, type Side } from "./overrides";

  interface Props {
    /** the group's name: "Trigger modifiers" */
    legend: string;
    /** what the modifiers do, in a sentence */
    hint: string;
    /** 8 bits: the left Ctrl, Shift, Alt, Gui, then the right ones */
    mask: number;
    /** a change is being saved: the toggles keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (mask: number) => void;
  }

  let { legend, hint, mask, busy, onchange }: Props = $props();
  const uid = $props.id();
  const SIDES: Side[] = ["Left", "Right"];
</script>

<fieldset class="mods" aria-describedby="{uid}-hint">
  <legend>{legend}</legend>
  <p class="hint" id="{uid}-hint">{hint}</p>
  {#each SIDES as side (side)}
    <div class="row">
      <span class="side" aria-hidden="true">{side}</span>
      {#each MOD_NAMES as mod (mod)}
        {@const bit = modBit(side, mod)}
        <button
          type="button"
          class="mod"
          aria-pressed={(mask & bit) !== 0}
          aria-label="{side} {mod}"
          aria-disabled={busy || undefined}
          onclick={() => {
            if (!busy) onchange(toggled(mask, bit));
          }}
        >{mod}</button>
      {/each}
    </div>
  {/each}
</fieldset>

<style>
  .mods {
    display: grid;
    gap: 5px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    font-size: 13px;
    font-weight: 650;
  }

  .hint {
    margin: 0 0 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .side {
    width: 36px;
    color: var(--text-3);
    font-size: 11.5px;
  }

  .mod {
    min-width: 46px;
    padding: 3px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
  }

  .mod:hover {
    border-color: var(--accent);
  }

  .mod[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--tone-mod) 70%, var(--border));
    background: color-mix(in srgb, var(--tone-mod) 16%, var(--surface));
    color: var(--text);
    font-weight: 650;
  }

  .mod[aria-disabled="true"] {
    cursor: progress;
  }
</style>
