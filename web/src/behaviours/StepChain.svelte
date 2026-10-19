<script lang="ts">
  import { stepVerb, stepWhat, type Step } from "./macro";

  interface Props {
    steps: Step[];
  }

  // a macro's steps as a chain: type “git status” → tap Enter → wait 50 ms
  let { steps }: Props = $props();
</script>

{#if steps.length === 0}
  <p class="none">No steps yet.</p>
{:else}
  <ol class="chain">
    {#each steps as step, i (i)}
      <li class="step {step.type}">
        <i>{stepVerb(step)}</i>
        <span title={stepWhat(step)}>{stepWhat(step)}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .chain {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: inline-grid;
    max-width: 100%;
    padding: 3px 9px 4px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--board-bg);
  }

  /* an arrow between two steps */
  .step + .step::before {
    content: "→";
    position: absolute;
    margin-left: -18px;
    color: var(--text-3);
  }

  .step + .step {
    position: relative;
    margin-left: 14px;
  }

  .step.tap,
  .step.down,
  .step.up {
    border-color: color-mix(in srgb, var(--tone-macro) 45%, var(--border));
    background: color-mix(in srgb, var(--tone-macro) 10%, var(--surface));
  }

  i {
    color: var(--text-3);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 600;
    line-height: 1.2;
  }

  span {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .none {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }
</style>
