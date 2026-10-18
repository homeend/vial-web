<script lang="ts">
  import type { ComboUse } from "../analysis/combos";
  import type { Described, KeyboardModel } from "../api/types";
  import KeyCap from "../keyboard/KeyCap.svelte";
  import { actionSummary, keyFace, keyTitle, layerLabel, type Names } from "../keyboard/labels";
  import { actionAt, positionLine, refId, type KeyRef } from "../keyboard/refs";
  import Button from "../ui/Button.svelte";
  import SectionTitle from "../ui/SectionTitle.svelte";
  import ComboList from "./ComboList.svelte";
  import { tapCodeOf } from "./hold";
  import HoldEditor from "./HoldEditor.svelte";
  import { freeTapDance, tapDanceSlots } from "./tapdance";

  interface Props {
    model: KeyboardModel;
    names: Names;
    layer: number;
    selection: KeyRef;
    canEdit: boolean;
    /** the combos the key is part of on the layer */
    comboUses: ComboUse[];
    onchangekey: () => void;
    onsetcode: (code: string, action: string) => Promise<boolean>;
    ontapdance: () => void;
    onjump: (layer: number) => void;
  }

  let {
    model, names, layer, selection, canEdit, comboUses, onchangekey, onsetcode, ontapdance, onjump,
  }: Props = $props();

  let editingHold = $state(false);
  // the hold editor is for one key on one layer: another one closes it
  let editedKey = "";
  $effect.pre(() => {
    const key = `${layer}:${refId(selection)}`;
    if (key !== editedKey) {
      editedKey = key;
      editingHold = false;
    }
  });

  function actionOn(index: number): Described {
    return actionAt(model, index, selection) as Described;
  }

  const current = $derived(actionOn(layer));
  const face = $derived(keyFace(current, names));
  const summary = $derived(actionSummary(current, names));
  const position = $derived(positionLine(model, selection, names.layer(layer)));
  const tapCode = $derived(selection.kind === "key" ? tapCodeOf(current) : null);
  const freeSlot = $derived(freeTapDance(model));
  // a key that does nothing, or falls through, has no action to put in a tap dance
  const emptyKey = $derived(current.kind === "none" || current.kind === "transparent");
  const tapDance = $derived(
    current.kind === "tap-dance" && current.index != null ? model.tapDance[current.index] : undefined,
  );

  const others = $derived(
    model.layers
      .filter((l) => l.index !== layer)
      .map((l) => {
        const d = actionOn(l.index);
        const otherFace = keyFace(d, names);
        const otherSummary = actionSummary(d, names);
        // in words, unless the key label says it all
        const detail = otherSummary.hold
          ? `hold: ${otherSummary.hold}`
          : otherSummary.tap !== otherFace.main ? otherSummary.tap : "";
        return { index: l.index, label: layerLabel(l.index, names), face: otherFace, detail };
      }),
  );

  async function applyHold(code: string) {
    if (await onsetcode(code, "Changing the hold action")) editingHold = false;
  }
</script>

<aside class="inspector" aria-label="Selected key">
  <header>
    <KeyCap {face} size={68} round={selection.kind === "encoder"} />
    <div class="heading">
      <h2>{keyTitle(current, names)}</h2>
      <p class="position" title={position}>{position}</p>
    </div>
  </header>

  <section class="code">
    <code>{current.code}</code>
    {#if current.description}<p>{current.description}</p>{/if}
  </section>

  {#if tapDance}
    <section class="tap-dance" aria-label="Tap dance {tapDance.index}">
      <SectionTitle>What each press does</SectionTitle>
      <dl class="rows">
        {#each tapDanceSlots(tapDance) as slot (slot.label)}
          <dt>{slot.label}</dt>
          <dd class:none={slot.action.kind === "none"}>
            {slot.action.kind === "none" ? "nothing" : actionSummary(slot.action, names).tap}
          </dd>
        {/each}
      </dl>
      <p class="term">Decides after {tapDance.tappingTerm} ms</p>
    </section>
  {:else}
    <dl class="rows">
      <dt>{selection.kind === "encoder" ? "Does" : "Tap"}</dt>
      <dd>{summary.tap}</dd>
      {#if summary.hold || tapCode}
        <dt>Hold</dt>
        <dd class:none={!summary.hold}>{summary.hold ?? "Same as tap"}</dd>
      {/if}
    </dl>
  {/if}

  <div class="buttons">
    <Button variant="primary" disabled={!canEdit} onclick={onchangekey}>Change key</Button>
    {#if tapCode}
      <Button
        disabled={!canEdit}
        aria-expanded={editingHold}
        aria-controls="hold-editor"
        onclick={() => (editingHold = !editingHold)}
      >
        Change hold
      </Button>
    {/if}
    <Button disabled={!canEdit || current.kind === "transparent"} onclick={() => onsetcode("KC_TRNS", "Making the key transparent")}>
      Make transparent
    </Button>
    <Button disabled={!canEdit || current.kind === "none"} onclick={() => onsetcode("KC_NO", "Clearing the key")}>
      Clear
    </Button>
    {#if selection.kind === "key" && current.kind !== "tap-dance"}
      <Button
        disabled={!canEdit || freeSlot === null || emptyKey}
        title={emptyKey
          ? "An empty or transparent key has no action to put in a tap dance"
          : freeSlot === null ? "Every tap dance is already in use" : `Uses tap dance ${freeSlot}`}
        onclick={ontapdance}
      >
        Turn into tap dance
      </Button>
    {/if}
  </div>

  {#if editingHold && tapCode}
    {#key `${layer}:${refId(selection)}`}
      <HoldEditor
        {current}
        tap={tapCode}
        layers={model.layers}
        disabled={!canEdit}
        onapply={applyHold}
        oncancel={() => (editingHold = false)}
      />
    {/key}
  {/if}

  {#if others.length > 0}
    <section class="others">
      <SectionTitle>On the other layers</SectionTitle>
      <ul>
        {#each others as other (other.index)}
          <li>
            <button type="button" title={other.label} onclick={() => onjump(other.index)}>
              <span class="other-layer">{other.label}</span>
              <span class="chip tone-{other.face.tone}" data-tone={other.face.tone}>{other.face.main || "—"}</span>
              <span class="other-summary">{other.detail}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if comboUses.length > 0}
    <ComboList uses={comboUses} {names} through={current.kind === "transparent"} />
  {/if}
</aside>

<style>
  .inspector {
    display: grid;
    /* not "auto": a long name, cut short, must not widen the column */
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    /* long names break rather than widen the panel */
    overflow-wrap: anywhere;
    align-content: start;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  header {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .heading {
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 17px;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }

  /* a long layer name is cut short; the tooltip has all of it */
  .position {
    margin: 4px 0 0;
    overflow: hidden;
    color: var(--text-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .code code {
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    font-weight: 600;
    word-break: break-all;
  }

  .code p {
    margin: 6px 0 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .rows {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 13.5px;
  }

  dt {
    color: var(--text-2);
    font-weight: 550;
  }

  dd {
    margin: 0;
    font-weight: 600;
  }

  dd.none {
    color: var(--text-3);
    font-weight: 450;
  }

  .tap-dance {
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--tone-tap-dance) 35%, var(--border));
    border-radius: 10px;
    background: color-mix(in srgb, var(--tone-tap-dance) 6%, var(--surface));
  }

  .term {
    margin: 8px 0 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .others ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .others button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 2px 10px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .others button:hover {
    background: var(--surface-2);
  }

  .other-layer {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .other-summary {
    grid-column: 1 / -1;
    color: var(--text-3);
    font-size: 12px;
  }

  .other-summary:empty {
    display: none;
  }

  .chip {
    min-width: 30px;
    max-width: 120px;
    overflow: hidden;
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--fill);
    font-size: 12.5px;
    font-weight: 650;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip.tone-transparent {
    border-style: dashed;
    background: transparent;
    color: var(--text-3);
  }

  .chip.tone-none {
    color: var(--text-3);
  }
</style>
