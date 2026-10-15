<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "md" | "sm";
    children: Snippet;
  }

  let { variant = "secondary", size = "md", type = "button", children, ...rest }: Props = $props();
</script>

<button class="btn {variant} {size}" {type} {...rest}>
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

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
