<script lang="ts">
  import type { Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import KeycodeButton from "./KeycodeButton.svelte";
  import LayerChips from "./LayerChips.svelte";
  import ModToggles from "./ModToggles.svelte";
  import OptionChecks from "./OptionChecks.svelte";
  import { KEY_OVERRIDE_OPTIONS, type KeyOverrideDraft } from "./overrides";

  interface Props {
    index: number;
    draft: KeyOverrideDraft;
    layerCount: number;
    names: Names;
    /** the key override is set up on the keyboard: it can be removed */
    removable: boolean;
    canSave: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (change: Partial<KeyOverrideDraft>) => void;
    onpick: (part: "trigger" | "replacement") => void;
    onsave: () => void;
    oncancel: () => void;
    onremove: () => void;
  }

  let {
    index, draft, layerCount, names, removable, canSave, busy, onchange, onpick, onsave, oncancel, onremove,
  }: Props = $props();

  /** it needs something to trigger it before it is worth saving */
  const noTrigger = $derived(draft.trigger.kind === "none" && draft.triggerMods === 0);
</script>

<div class="editor">
  <div class="keys">
    <KeycodeButton id="key-override-{index}-trigger" label="Trigger" action={draft.trigger} {names} {busy}
      onpick={() => onpick("trigger")} />
    <span class="arrow" aria-hidden="true">→</span>
    <KeycodeButton label="Replacement" action={draft.replacement} {names} {busy} onpick={() => onpick("replacement")} />
  </div>

  <div class="mods">
    <ModToggles legend="Trigger modifiers" hint="Held with the trigger key to start it. Set on both sides, either one does."
      mask={draft.triggerMods} {busy} onchange={(triggerMods) => onchange({ triggerMods })} />
    <ModToggles legend="Blocking modifiers" hint="None of these may be held: holding one stops it (negative mods)."
      mask={draft.negativeModMask} {busy} onchange={(negativeModMask) => onchange({ negativeModMask })} />
    <ModToggles legend="Hidden modifiers" hint="Hidden from the computer while it sends the replacement (suppressed mods)."
      mask={draft.suppressedMods} {busy} onchange={(suppressedMods) => onchange({ suppressedMods })} />
  </div>

  <LayerChips mask={draft.layers} count={layerCount} {names} {busy} onchange={(layers) => onchange({ layers })} />

  <OptionChecks legend="Options" options={KEY_OVERRIDE_OPTIONS} value={draft.options} {busy}
    onchange={(options) => onchange({ options })} />

  <div class="foot">
    <Switch label="Enabled" checked={draft.enabled} describedby={draft.enabled ? undefined : `key-override-${index}-off`}
      {busy} onchange={(enabled) => onchange({ enabled })} />
    {#if !draft.enabled}
      <span class="off-hint" id="key-override-{index}-off">It does nothing until it is switched on.</span>
    {/if}
    <span class="spacer"></span>
    {#if removable}
      <Button variant="danger" disabled={!canSave} aria-disabled={busy || undefined} onclick={onremove}>
        Remove
      </Button>
    {/if}
    {#if noTrigger}<span class="needs" id="key-override-{index}-needs">Choose a trigger key or modifiers</span>{/if}
    <Button aria-disabled={busy || undefined} onclick={oncancel}>Cancel</Button>
    <Button variant="primary" disabled={!canSave || noTrigger} aria-disabled={busy || undefined}
      aria-describedby={noTrigger ? `key-override-${index}-needs` : undefined} onclick={onsave}>Save</Button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 16px;
  }

  .keys {
    display: grid;
    grid-template-columns: minmax(0, 200px) auto minmax(0, 200px);
    justify-content: start;
    align-items: center;
    gap: 10px;
  }

  .arrow {
    color: var(--text-3);
    font-size: 20px;
  }

  .mods {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
    gap: 14px 20px;
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

  .off-hint {
    color: var(--text-2);
    font-size: 12.5px;
  }
</style>
