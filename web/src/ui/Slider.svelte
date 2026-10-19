<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    id?: string;
    label: string;
    value: number;
    min?: number;
    max: number;
    step?: number;
    /** the value in words, shown beside the label and said by screen readers: "75 %", "210°" */
    valueText: string;
    disabled?: boolean;
    describedby?: string;
    /** a move of the thumb (dragged, or with the keyboard): every value it passes */
    oninput: (value: number) => void;
    /** drawn behind the track, e.g. the hues a hue slider goes through (a CSS background) */
    track?: string;
    /** after the label, e.g. a note on what the keyboard takes */
    extra?: Snippet;
  }

  let {
    id, label, value, min = 0, max, step = 1, valueText, disabled = false, describedby, oninput, track, extra,
  }: Props = $props();
  const uid = $props.id();
  const inputId = $derived(id ?? `${uid}-range`);
</script>

<div class="slider" class:painted={track !== undefined}>
  <div class="head">
    <label for={inputId}>{label}</label>
    <output for={inputId} aria-hidden="true">{valueText}</output>
    {@render extra?.()}
  </div>
  <input
    id={inputId}
    type="range"
    {min}
    {max}
    {step}
    {value}
    {disabled}
    aria-valuetext={valueText}
    aria-describedby={describedby}
    style={track ? `--track: ${track}` : undefined}
    oninput={(event) => oninput(Number(event.currentTarget.value))}
  />
</div>

<style>
  .slider {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }

  label {
    font-size: 13px;
    font-weight: 550;
  }

  output {
    color: var(--text-2);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  input {
    width: 100%;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* a painted track (the hues): the native track made see-through over it, in Firefox and Chromium alike */
  .painted input {
    height: 18px;
    border-radius: 999px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px var(--border-strong);
    appearance: none;
  }

  .painted input::-webkit-slider-runnable-track {
    background: transparent;
  }

  .painted input::-moz-range-track {
    background: transparent;
  }

  .painted input::-moz-range-progress {
    background: transparent;
  }

  .painted input::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 1px var(--text);
    appearance: none;
  }

  .painted input::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 1px var(--text);
  }

  .painted input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
</style>
