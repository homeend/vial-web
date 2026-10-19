<script lang="ts">
  import Button from "../ui/Button.svelte";

  interface Props {
    tone: "danger" | "warning";
    title: string;
    message: string;
    actionLabel?: string;
    onaction?: () => void;
    /** an id for the banner, so that it can take the focus from script (when what had it went away): only a banner
     * with one can (tabindex -1), so a click on another's text leaves the focus where it was (e.g. on the page, where
     * the Keymap's arrow keys start) */
    id?: string;
  }

  let { tone, title, message, actionLabel, onaction, id }: Props = $props();
</script>

<!-- danger interrupts (the keyboard is unplugged, or couldn't be read); warning waits its turn -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex (the check can't tell: it is -1 or none, never in the Tab order) -->
<div class="banner {tone}" role={tone === "danger" ? "alert" : "status"} {id} tabindex={id ? -1 : undefined}>
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 3l8 14H2z" />
    <path d="M10 8.5v3.5M10 14.5v.01" />
  </svg>
  <div class="text">
    <strong>{title}</strong>
    <span>{message}</span>
  </div>
  {#if actionLabel && onaction}
    <Button size="sm" onclick={onaction}>{actionLabel}</Button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid;
    border-radius: 12px;
    font-size: 13.5px;
  }

  .danger {
    border-color: var(--danger-line);
    background: var(--danger-weak);
  }

  .warning {
    border-color: color-mix(in srgb, var(--warning-text) 30%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  svg {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .danger svg {
    color: var(--danger);
  }

  .text {
    flex: 1;
  }

  strong {
    display: block;
  }

  span {
    color: var(--text-2);
  }

  .warning span {
    color: inherit;
  }
</style>
