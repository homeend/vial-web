<script lang="ts">
  import type { VialRgb } from "../api/types";
  import SelectField from "../ui/SelectField.svelte";
  import Slider from "../ui/Slider.svelte";
  import { brightnessTrack, percent, percentOf } from "./colour";
  import ColourPicker from "./ColourPicker.svelte";
  import { vialRgbChoices, vialRgbNote } from "./effects";
  import LightingCard from "./LightingCard.svelte";
  import type { LightingPatch } from "./lighting";

  interface Props {
    /** what the keyboard shows, with the changes on their way put over it */
    value: VialRgb;
    disabled: boolean;
    onchange: (patch: LightingPatch) => void;
  }

  let { value, disabled, onchange }: Props = $props();
  const uid = $props.id();

  const hue = $derived(value.hsv[0]);
  const saturation = $derived(value.hsv[1]);
  const brightness = $derived(value.hsv[2]);
  const note = $derived(vialRgbNote(value.mode));
  const capped = $derived(value.maxBrightness < 255);
  const choices = $derived(vialRgbChoices(value.supportedEffects, value.mode)
    .map((c) => ({ value: String(c.value), label: c.label })));

  function colour(hsv: [number, number, number]) {
    onchange({ vialrgb: { hsv } });
  }
</script>

<LightingCard title="RGB matrix" about="The per-key lights (VialRGB): an effect, how fast it runs, and its colour.">
  <SelectField label="Effect" value={String(value.mode)} {choices} {disabled}
    describedby={note ? `${uid}-note` : undefined} onchange={(mode) => onchange({ vialrgb: { mode: Number(mode) } })} />
  {#if note}<p class="note" id="{uid}-note">{note}</p>{/if}
  <Slider label="Speed" value={value.speed} max={255} valueText={percent(value.speed)} {disabled}
    oninput={(speed) => onchange({ vialrgb: { speed } })} />
  <ColourPicker {hue} {saturation} {disabled} onchange={(c) => colour([c.hue, c.saturation, brightness])} />
  <Slider label="Brightness" value={brightness} max={value.maxBrightness}
    valueText={percentOf(brightness, value.maxBrightness)} {disabled} track={brightnessTrack(hue, saturation, value.maxBrightness)}
    describedby={capped ? `${uid}-cap` : undefined} oninput={(v) => colour([hue, saturation, v])} />
  {#if capped}
    <p class="note" id="{uid}-cap">
      100 % is the brightest this keyboard's firmware allows: {percent(value.maxBrightness)} of what its lights can do.
    </p>
  {/if}
</LightingCard>
