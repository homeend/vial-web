<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "md" | "sm";
    children: Snippet;
  }

  let { variant = "secondary", size = "md", type = "button", class: className, children, ...rest }: Props = $props();
</script>

<!-- a caller's class is added to the button's own -->
<button class={["btn", variant, size, className]} {type} {...rest}>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.12s, border-color 0.12s;
  }

  .md {
    padding: 7px 12px;
    font-size: 13px;
  }

  .sm {
    padding: 4px 9px;
    font-size: 12px;
  }

  .btn:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, black);
  }

  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--text-2);
  }

  .danger {
    color: var(--danger);
  }

  /* a toggle that is on (the Inspector's Swap or Copy while the other key is chosen) */
  .btn[aria-pressed="true"] {
    border-color: var(--accent);
    background: var(--accent-weak);
    color: var(--text);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* enabled, keeping the focus, but taking nothing while a change is saved */
  .btn[aria-disabled="true"]:not(:disabled) {
    cursor: progress;
  }
</style>
