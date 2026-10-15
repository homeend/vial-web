<script lang="ts">
  import { toasts } from "../lib/toasts.svelte";
</script>

<div class="toasts" role="status" aria-live="assertive">
  {#each toasts.items as toast (toast.id)}
    <div class="toast">
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(toast.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 50;
    display: grid;
    gap: 8px;
    width: min(380px, calc(100vw - 40px));
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--danger-line);
    border-left: 4px solid var(--danger);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    font-size: 13.5px;
  }

  span {
    flex: 1;
  }

  button {
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
</style>
