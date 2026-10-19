<script lang="ts">
  import type { Backlight } from "../api/types";
  import Slider from "../ui/Slider.svelte";
  import Switch from "../ui/Switch.svelte";
  import { percent } from "./colour";
  import LightingCard from "./LightingCard.svelte";
  import type { LightingPatch } from "./lighting";

  interface Props {
    /** what the keyboard shows, with the changes on their way put over it */
    value: Backlight;
    disabled: boolean;
    onchange: (patch: LightingPatch) => void;
  }

  let { value, disabled, onchange }: Props = $props();
  const uid = $props.id();
</script>

<LightingCard title="Backlight" about="QMK's single-colour backlight: its brightness, and whether it breathes.">
  <Slider label="Brightness" value={value.brightness} max={255} valueText={percent(value.brightness)} {disabled}
    describedby="{uid}-steps" oninput={(brightness) => onchange({ backlight: { brightness } })} />
  <p class="note" id="{uid}-steps">
    The backlight has a few brightness steps (3, unless its firmware sets another number): it takes the step at or
    below the one chosen, and the slider then shows it.
  </p>
  <Switch label="Breathing" checked={value.effect !== 0} {disabled} describedby="{uid}-breathing"
    onchange={(on) => onchange({ backlight: { effect: on ? 1 : 0 } })} />
  <p class="note" id="{uid}-breathing">
    Only a keyboard whose firmware is built with breathing can breathe; on another, the switch turns back off. The
    keyboard keeps a change of breathing at once, without a Save, with the brightness it runs at.
  </p>
</LightingCard>
