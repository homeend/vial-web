<script lang="ts">
  import type { Use } from "../analysis/usage";
  import type { Names } from "../keyboard/labels";
  import { useLabel } from "./sentences";

  interface Props {
    uses: Use[];
    names: Names;
    /** every placed key's position in words, by refId */
    positions: Map<string, string>;
    /** what to put on a key to use it, for the warning when nothing does: "TD(3)" */
    keycode: string;
    /** go to a use: the key in the Keymap, or the combo, tap dance, macro, key override or alt-repeat key on its page */
    onopen: (use: Use) => void;
  }

  let { uses, names, positions, keycode, onopen }: Props = $props();
</script>

{#if uses.length === 0}
  <p class="unused">Nothing uses it yet: put <code>{keycode}</code> on a key in the Keymap to use it.</p>
{:else}
  <div class="used">
    <span class="label">Used on</span>
    <ul>
      {#each uses as use, i (i)}
        {@const label = useLabel(use, names, positions)}
        <li>
          <button type="button" title="{label} · go there" onclick={() => onopen(use)}>{label}</button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .used {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    font-size: 12.5px;
  }

  .label {
    color: var(--text-3);
    font-weight: 600;
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: inline-block;
    max-width: 100%;
    padding: 1px 9px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.6;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--accent);
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-weak);
  }

  .unused {
    margin: 0;
    padding: 6px 10px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }
</style>
