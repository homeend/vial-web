<script lang="ts">
  import { memoryLevel } from "./macro";

  interface Props {
    /** bytes the macros take, with what is being edited */
    used: number;
    /** bytes the keyboard has for them */
    memory: number;
  }

  let { used, memory }: Props = $props();

  const level = $derived(memoryLevel(used, memory));
  const share = $derived(memory > 0 ? Math.min(1, used / memory) : 1);
</script>

<div class="memory {level}">
  <div class="text">
    <span class="title" id="macro-memory-title">Macro memory</span>
    <span class="count" aria-live="polite">
      {#if level === "over"}
        Needs {used} bytes, but the keyboard has {memory}: take {used - memory} out.
      {:else}
        Uses {used} of {memory} bytes{level === "near" ? ": nearly full" : ""}
      {/if}
    </span>
  </div>
  <div
    class="bar"
    role="meter"
    aria-labelledby="macro-memory-title"
    aria-valuemin={0}
    aria-valuemax={memory}
    aria-valuenow={Math.min(used, memory)}
    aria-valuetext="{used} of {memory} bytes"
  >
    <span style="width: {share * 100}%"></span>
  </div>
</div>

<style>
  .memory {
    display: grid;
    gap: 6px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }

  .text {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: 13px;
  }

  .title {
    font-weight: 650;
  }

  .count {
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .bar {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .near .bar span {
    background: var(--tone-macro);
  }

  .near .count {
    color: var(--warning-text);
    font-weight: 600;
  }

  .over {
    border-color: var(--danger-line);
    background: var(--danger-weak);
  }

  .over .bar span {
    background: var(--danger);
  }

  .over .count {
    color: var(--danger);
    font-weight: 650;
  }
</style>
