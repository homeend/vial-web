<script lang="ts">
  import Slider from "../ui/Slider.svelte";
  import { degrees, HUE_TRACK, hsvToRgb, percent, pickedHueSat, rgbToHex, saturationTrack } from "./colour";

  interface Props {
    /** QMK's hue and saturation, 0-255 */
    hue: number;
    saturation: number;
    disabled: boolean;
    onchange: (colour: { hue: number; saturation: number }) => void;
  }

  let { hue, saturation, disabled, onchange }: Props = $props();
  const uid = $props.id();

  /** the colour at full brightness: the swatch, what the browser's picker starts from, and what it sets */
  const full = $derived(rgbToHex(hsvToRgb(hue, saturation, 255)));
</script>

<fieldset class="colour" aria-describedby="{uid}-help">
  <legend>Colour</legend>
  <!-- the browser's own colour picker is the swatch: a click opens it -->
  <label class="pick">
    <input type="color" value={full} {disabled}
      oninput={(event) => {
        const picked = pickedHueSat(event.currentTarget.value, hue);
        if (picked) onchange(picked);
      }}
      onchange={(event) => {
        // once picked, the swatch shows the colour the keyboard takes: the picked colour at full brightness. A darker
        // one has the same hue and saturation, so `full` doesn't change and Svelte wouldn't write it back.
        event.currentTarget.value = full;
      }} />
    <span>Pick a colour…</span>
  </label>
  <p class="help" id="{uid}-help">A colour picked sets the hue and saturation; the brightness has a slider of its own.</p>
  <Slider label="Hue" value={hue} max={255} valueText={degrees(hue)} {disabled} track={HUE_TRACK}
    oninput={(value) => onchange({ hue: value, saturation })} />
  <Slider label="Saturation" value={saturation} max={255} valueText={percent(saturation)} {disabled}
    track={saturationTrack(hue)} oninput={(value) => onchange({ hue, saturation: value })} />
</fieldset>

<style>
  .colour {
    display: grid;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 550;
  }

  .pick {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 10px;
    font-size: 13px;
    cursor: pointer;
  }

  .pick:has(input:disabled) {
    cursor: not-allowed;
  }

  input {
    width: 56px;
    height: 34px;
    padding: 2px;
    border: 1px solid color-mix(in srgb, var(--text-3) 80%, var(--text));
    border-radius: 8px;
    background: var(--surface-2);
    cursor: pointer;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .help {
    margin: -4px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
  }
</style>
