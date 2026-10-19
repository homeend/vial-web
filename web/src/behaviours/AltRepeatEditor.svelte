<script lang="ts">
  import type { Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import KeycodeButton from "./KeycodeButton.svelte";
  import ModToggles from "./ModToggles.svelte";
  import OptionChecks from "./OptionChecks.svelte";
  import { ALT_REPEAT_OPTIONS, type AltRepeatDraft } from "./overrides";

  interface Props {
    index: number;
    draft: AltRepeatDraft;
    names: Names;
    /** the alt-repeat key is set up on the keyboard: it can be removed */
    removable: boolean;
    canSave: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (change: Partial<AltRepeatDraft>) => void;
    onpick: (part: "keycode" | "altKeycode") => void;
    onsave: () => void;
    oncancel: () => void;
    onremove: () => void;
  }

  let { index, draft, names, removable, canSave, busy, onchange, onpick, onsave, oncancel, onremove }: Props = $props();

  const noKey = $derived(draft.keycode.kind === "none");
</script>

<div class="editor">
  <div class="top">
    <div class="keys">
      <KeycodeButton id="alt-repeat-{index}-keycode" label="Last key" action={draft.keycode} {names} {busy}
        onpick={() => onpick("keycode")} />
      <span class="arrow" aria-hidden="true">→</span>
      <KeycodeButton label="Alt key" action={draft.altKeycode} {names} {busy} onpick={() => onpick("altKeycode")} />
    </div>
    <ModToggles legend="Allowed modifiers"
      hint="It also counts when these were held with the last key. With none, only the key pressed alone counts."
      mask={draft.allowedMods} {busy} onchange={(allowedMods) => onchange({ allowedMods })} />
  </div>

  <OptionChecks legend="Options" options={ALT_REPEAT_OPTIONS} value={draft.options} {busy}
    onchange={(options) => onchange({ options })} />

  <div class="foot">
    <Switch label={draft.enabled ? "On" : "Off: it does nothing until it is switched on"} checked={draft.enabled}
      {busy} onchange={(enabled) => onchange({ enabled })} />
    <span class="spacer"></span>
    {#if removable}
      <Button variant="danger" disabled={!canSave} aria-disabled={busy || undefined} onclick={onremove}>Remove</Button>
    {/if}
    {#if noKey}<span class="needs" id="alt-repeat-{index}-needs">Choose the last key</span>{/if}
    <Button aria-disabled={busy || undefined} onclick={oncancel}>Cancel</Button>
    <Button variant="primary" disabled={!canSave || noKey} aria-disabled={busy || undefined}
      aria-describedby={noKey ? `alt-repeat-${index}-needs` : undefined} onclick={onsave}>Save</Button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 16px;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 16px 32px;
  }

  .keys {
    display: grid;
    grid-template-columns: minmax(0, 170px) auto minmax(0, 170px);
    justify-content: start;
    align-items: center;
    gap: 10px;
    flex: 1 1 360px;
    max-width: 400px;
  }

  .arrow {
    color: var(--text-3);
    font-size: 20px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .spacer {
    flex: 1;
  }

  .needs {
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
