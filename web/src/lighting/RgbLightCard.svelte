<script lang="ts">
  import type { RgbLight } from "../api/types";
  import SelectField from "../ui/SelectField.svelte";
  import Slider from "../ui/Slider.svelte";
  import { brightnessTrack, percent } from "./colour";
  import ColourPicker from "./ColourPicker.svelte";
  import { rgbLightChoices, rgbLightNote } from "./effects";
  import LightingCard from "./LightingCard.svelte";
  import type { LightingPatch } from "./lighting";

  interface Props {
    /** what the keyboard shows, with the changes on their way put over it */
    value: RgbLight;
    disabled: boolean;
    onchange: (patch: LightingPatch) => void;
  }

  let { value, disabled, onchange }: Props = $props();
  const uid = $props.id();

  const note = $derived(rgbLightNote(value.effect));
  const choices = $derived(rgbLightChoices(value.effect).map((c) => ({ value: String(c.value), label: c.label })));
</script>

<LightingCard title="RGB light" about="QMK's RGB light (often underglow): an effect, its colour and its brightness.">
  <SelectField label="Effect" value={String(value.effect)} {choices} {disabled}
    describedby="{uid}-numbers{note ? ` ${uid}-note` : ''}"
    onchange={(effect) => onchange({ rgblight: { effect: Number(effect) } })} />
  {#if note}<p class="note" id="{uid}-note">{note}</p>{/if}
  <p class="note" id="{uid}-numbers">
    These are Vial's names for the effects' numbers. A keyboard built with only some effects numbers the rest
    differently, so a name may start another effect.
  </p>
  <ColourPicker hue={value.hue} saturation={value.saturation} {disabled}
    onchange={(c) => onchange({ rgblight: { hue: c.hue, saturation: c.saturation } })} />
  <Slider label="Brightness" value={value.brightness} max={255} valueText={percent(value.brightness)} {disabled}
    track={brightnessTrack(value.hue, value.saturation)} oninput={(brightness) => onchange({ rgblight: { brightness } })} />
</LightingCard>
