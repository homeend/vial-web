<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** "TD 3", "Combo 2", "M 0" */
    id: string;
    /** the heading's id, for the card's aria-labelledby */
    headingId: string;
    /** the name, cut short with a tooltip when it is long; null for an entry without names (a combo) */
    name: string | null;
    tone: "tap-dance" | "macro" | "combo" | "override";
    /** renames it, when it can be named */
    onrename?: () => void;
    renameLabel?: string;
    canEdit: boolean;
    /** on the right: the card's own controls */
    actions?: Snippet;
  }

  let { id, headingId, name, tone, onrename, renameLabel, canEdit, actions }: Props = $props();
</script>

<header class="head">
  <h2 id={headingId} tabindex="-1">
    <span class="id {tone}">{id}</span>
    {#if name !== null}<span class="name" title={name}>{name}</span>{/if}
  </h2>
  {#if onrename}
    <button type="button" class="rename" aria-label={renameLabel} title="Rename" disabled={!canEdit} onclick={onrename}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" /></svg>
    </button>
  {/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 6px 8px;
    min-width: 0;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    margin: 0;
    font-size: 15px;
  }

  h2:focus {
    outline: none;
  }

  .id {
    flex: none;
    padding: 2px 7px;
    border-radius: 5px;
    font: 650 11.5px/1.4 var(--mono);
  }

  .id.tap-dance {
    background: color-mix(in srgb, var(--tone-tap-dance) 16%, transparent);
    color: color-mix(in srgb, var(--tone-tap-dance) 75%, var(--text));
  }

  .id.macro {
    background: color-mix(in srgb, var(--tone-macro) 18%, transparent);
    color: color-mix(in srgb, var(--tone-macro) 60%, var(--text));
  }

  .id.combo {
    background: color-mix(in srgb, var(--colour, var(--combo-0)) 16%, transparent);
    color: color-mix(in srgb, var(--colour, var(--combo-0)) 75%, var(--text));
  }

  /* key overrides and alt-repeat keys */
  .id.override {
    background: var(--accent-weak);
    /* toward the text, so it reads (4.5:1) in both themes */
    color: color-mix(in srgb, var(--accent) 80%, var(--text));
  }

  /* a long name is cut short; the tooltip has all of it */
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .rename:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .rename:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .rename svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
  }
</style>
