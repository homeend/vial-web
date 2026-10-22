<script lang="ts">
  import { tick } from "svelte";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import type { LearningSettings } from "./types";

  interface Props {
    open: boolean;
    settings: LearningSettings;
    /** resolves to whether they were saved: the dialog then closes, or stays open (a toast says why) */
    onsave: (settings: LearningSettings) => Promise<boolean>;
    /** closed, saved or not: the caller gives the focus back to the gear */
    onclose: () => void;
  }

  let { open, settings, onsave, onclose }: Props = $props();

  /** the server's limits (schemas.LearningSettingsIn) */
  const ACCURACY = { min: 50, max: 100 };
  const WPM = { min: 1, max: 300 };

  let dialog = $state<HTMLDialogElement>();
  let first = $state<HTMLInputElement>();
  let working = $state(false);
  let passAccuracy = $state(95);
  let targetWpm = $state(30);
  let pictureInWords = $state(true);
  let problem = $state<string | null>(null);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      // what is saved, each time it opens
      passAccuracy = settings.passAccuracy;
      targetWpm = settings.targetWpm;
      pictureInWords = settings.pictureInWords;
      problem = null;
      working = false;
      dialog.showModal();
      void tick().then(() => first?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function whole(value: number, range: { min: number; max: number }): boolean {
    return Number.isInteger(value) && value >= range.min && value <= range.max;
  }

  async function save() {
    if (working) return;
    if (!whole(passAccuracy, ACCURACY)) {
      problem = `The pass accuracy is a whole number from ${ACCURACY.min} to ${ACCURACY.max}.`;
      return;
    }
    if (!whole(targetWpm, WPM)) {
      problem = `The target speed is a whole number from ${WPM.min} to ${WPM.max}.`;
      return;
    }
    problem = null;
    working = true;
    let done = false;
    try {
      done = await onsave({ passAccuracy, targetWpm, pictureInWords });
    } finally {
      working = false;
    }
    if (done) dialog?.close();
  }
</script>

<dialog bind:this={dialog} class="settings" aria-labelledby="{uid}-title" onclose={onclose}
  onkeydown={(event) => {
    if (event.key === "Escape" && working) event.preventDefault();
  }}
  oncancel={(event) => {
    if (working) event.preventDefault();
  }}>
  <h2 id="{uid}-title">Learning settings</h2>
  <p class="about">What passes a lesson, and what earns a star. Both apply to every lesson set of this keyboard.</p>
  <label class="field">
    <span>Pass accuracy</span>
    <span class="input"><input bind:this={first} type="number" min={ACCURACY.min} max={ACCURACY.max} step="1"
      bind:value={passAccuracy} readonly={working} /> %</span>
  </label>
  <label class="field">
    <span>Target speed</span>
    <span class="input"><input type="number" min={WPM.min} max={WPM.max} step="1" bind:value={targetWpm}
      readonly={working} /> wpm</span>
  </label>
  <Switch label="Show the picture in word exercises" checked={pictureInWords} busy={working}
    onchange={(checked) => (pictureInWords = checked)} />
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  <div class="buttons">
    <Button aria-disabled={working || undefined} onclick={() => {
      if (!working) dialog?.close();
    }}>Cancel</Button>
    <Button variant="primary" aria-disabled={working || undefined} onclick={() => void save()}>
      {working ? "Saving…" : "Save"}
    </Button>
  </div>
</dialog>

<style>
  .settings {
    width: min(420px, calc(100vw - 32px));
    max-width: none;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .settings::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 17px;
  }

  .about {
    margin: 0 0 14px;
    color: var(--text-2);
    font-size: 13px;
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 550;
  }

  .input {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
    color: var(--text-2);
  }

  input {
    width: 72px;
    padding: 5px 8px;
    border: 1px solid color-mix(in srgb, var(--text-3) 80%, var(--text));
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }

  .problem {
    margin: 10px 0 0;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 13px;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
