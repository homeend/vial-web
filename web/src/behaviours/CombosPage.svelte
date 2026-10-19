<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import { COMBO_COLOURS, type ComboInfo } from "../analysis/combos";
  import type { Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import ComboCard from "./ComboCard.svelte";
  import { freeCombo, shownEntries } from "./entries";
  import { isSet, membersOf, toggleMember } from "./members";
  import PageHeader from "./PageHeader.svelte";
  import { comboNotes, comboSentence } from "./sentences";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    analysis: Analysis;
    /** the combo to show (from the address), or null */
    item: number | null;
  }

  let { model, placement, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit && keyboard.pending === 0);
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.combos.length, (i) => isSet(model.combos[i]),
    item === null ? opened : [...opened, item]));
  const free = $derived(freeCombo(model));
  const unshown = $derived(model.combos.length - shown.length);

  useTarget(() => (item === null ? null : `combo-${item}-title`));

  /** the combo being edited: one at a time */
  let draft = $state<{ index: number; members: Described[]; output: Described } | null>(null);
  let problem = $state<string | null>(null);

  /** a combo as the analysis sees it: its keycodes with their keys on the base layer */
  function infoOf(index: number, members: Described[], output: Described): ComboInfo {
    return { index, members: members.map((action) => ({ action, keys: analysis.codes[0]?.get(action.code) ?? [] })), output };
  }

  const cards = $derived(shown.map((index) => {
    const combo = model.combos[index];
    const editing = draft?.index === index ? draft : null;
    const info = editing ? infoOf(index, editing.members, editing.output)
      : analysis.combos.find((c) => c.index === index) ?? infoOf(index, [], combo.output);
    return {
      combo,
      info,
      editing,
      colour: analysis.comboColours.get(index) ?? analysis.comboColours.size % COMBO_COLOURS,
      sentence: comboSentence(info, model, names),
      notes: info.members.length > 0 ? comboNotes(info, analysis.codes, names) : [],
    };
  }));

  function edit(index: number) {
    const combo = model.combos[index];
    draft = { index, members: membersOf(combo), output: combo.output };
    problem = null;
  }

  function choose(d: Described) {
    if (!draft) return;
    const result = toggleMember(draft.members, d);
    draft.members = result.members;
    problem = result.problem;
  }

  async function save(keys: string[], output: string, action: string) {
    if (!draft) return;
    const index = draft.index;
    if (await keyboard.setCombo(index, keys, output, action)) {
      draft = null;
      document.getElementById(`combo-${index}-title`)?.focus();
    }
  }

  function newCombo() {
    if (free === null) return;
    opened = [...opened, free];
    router.go("combos", free);
    edit(free);
  }

  // the keycode picker: a key to add by its keycode, or the output
  let pickerOpen = $state(false);
  let picking = $state<"member" | "output">("output");

  function pick(part: "member" | "output") {
    picking = part;
    pickerOpen = true;
  }
</script>

<section class="page" aria-labelledby="combos-title">
  <PageHeader
    id="combos-title"
    title="Combos"
    description="Keys pressed together for another key. Each combo has its colour, which marks its keys in the keymap too."
  >
    {#snippet action()}
      <Button variant="primary" disabled={!canEdit || free === null || draft !== null}
        title={free === null ? "Every combo is in use" : `Sets up combo ${free}`} onclick={newCombo}>
        New combo
      </Button>
    {/snippet}
  </PageHeader>

  {#if shown.length === 0}
    <p class="empty">No combo is set up yet.</p>
  {/if}
  {#each cards as card (card.combo.index)}
    <ComboCard
      combo={card.combo}
      {model}
      {placement}
      {names}
      colour={card.colour}
      sentence={card.sentence}
      notes={card.notes}
      canEdit={canEdit && (draft === null || card.editing !== null)}
      target={card.combo.index === item}
      draft={card.editing}
      problem={card.editing ? problem : null}
      onedit={() => edit(card.combo.index)}
      onchoose={choose}
      onremove={(code) => {
        if (draft) draft.members = draft.members.filter((m) => m.code !== code);
        problem = null;
      }}
      onaddbycode={() => pick("member")}
      onpickoutput={() => pick("output")}
      onsave={() => draft && void save(draft.members.map((m) => m.code), draft.output.code, "Saving the combo")}
      oncancel={() => {
        const index = draft?.index;
        draft = null;
        if (index !== undefined) document.getElementById(`combo-${index}-title`)?.focus();
      }}
      onclear={() => void save([], "KC_NO", "Removing the combo")}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "combo is" : "combos are"} free, of {model.combos.length}.</p>
  {/if}
</section>

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject={picking === "output" ? `Output of combo ${draft.index}` : `A key of combo ${draft.index}`}
    categories={keyboard.catalogue}
    current={picking === "output" ? draft.output.code : "KC_NO"}
    {names}
    onpick={(_, d) => {
      if (!draft) return;
      if (picking === "output") draft.output = d;
      else if (draft.members.some((m) => m.code === d.code)) problem = `${d.tap || d.code} is in the combo already.`;
      else choose(d);
    }}
  />
{/if}

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .empty,
  .more {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .empty {
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    text-align: center;
  }
</style>
