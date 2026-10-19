<script lang="ts">
  import { tick } from "svelte";
  import { toasts } from "../lib/toasts.svelte";

  let region: HTMLElement;
  /** where focus was before it came into the toasts: it goes back there when the last focused toast goes */
  let returnTo: HTMLElement | null = null;

  function focusIn(id: number, event: FocusEvent) {
    toasts.hold(id, "focus", true);
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !region.contains(from)) returnTo = from;
  }

  function focusOut(id: number, event: FocusEvent) {
    const to = event.relatedTarget;
    // the window lost focus: the toast still has it when the reader comes back
    if (to === null && !document.hasFocus()) return;
    if (!(to instanceof Node && (event.currentTarget as HTMLElement).contains(to))) toasts.hold(id, "focus", false);
  }

  function dismiss(id: number) {
    return leave(id, async () => toasts.dismiss(id));
  }

  function act(id: number) {
    return leave(id, () => toasts.act(id));
  }

  /** Runs what may remove a toast; if it had the focus, the focus goes to a toast next to it, or back */
  async function leave(id: number, run: () => Promise<void>) {
    const i = toasts.items.findIndex((t) => t.id === id);
    const hadFocus = region.querySelector(`[data-toast="${id}"]`)?.contains(document.activeElement) ?? false;
    // the next toast's button, else the one before, else where focus came from
    const neighbour = toasts.items[i + 1] ?? toasts.items[i - 1];
    await run();
    if (!hadFocus || toasts.items.some((t) => t.id === id)) return;
    await tick();
    const next = neighbour && region.querySelector<HTMLElement>(`[data-toast="${neighbour.id}"] button`);
    const target = next ?? (returnTo?.isConnected ? returnTo : region);
    target.focus();
  }
</script>

<!-- the live regions read out each message alone (not the buttons): a failure at once, what was done when the reader
     is free; the toasts themselves aren't live -->
<div class="visually-hidden" aria-live="assertive">
  {#each toasts.items.filter((t) => t.tone === "error") as toast (toast.id)}
    <p>{toast.message}</p>
  {/each}
</div>
<div class="visually-hidden" aria-live="polite">
  {#each toasts.items.filter((t) => t.tone === "info") as toast (toast.id)}
    <p>{toast.message}</p>
  {/each}
</div>

<section class="toasts" aria-label="Notifications" tabindex="-1" bind:this={region}>
  {#each toasts.items as toast (toast.id)}
    <div
      class="toast {toast.tone}"
      data-toast={toast.id}
      role="group"
      onmouseenter={() => toasts.hold(toast.id, "hover", true)}
      onmouseleave={() => toasts.hold(toast.id, "hover", false)}
      onfocusin={(e) => focusIn(toast.id, e)}
      onfocusout={(e) => focusOut(toast.id, e)}
    >
      <span>{toast.message}</span>
      {#if toast.action}
        <!-- the toast goes once its action is done: the focus then goes where a dismissal sends it -->
        <button type="button" class="action" onclick={() => act(toast.id)}>{toast.action.label}</button>
      {/if}
      <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => dismiss(toast.id)}>×</button>
    </div>
  {/each}
</section>

<style>
  .toasts {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 50;
    display: grid;
    gap: 8px;
    width: min(380px, calc(100vw - 40px));
    outline: none;
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

  .toast.info {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    border-left-color: var(--accent);
  }

  span {
    flex: 1;
  }

  .dismiss {
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .action {
    flex: none;
    margin: -3px 0;
    padding: 3px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    color: var(--accent);
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
  }

  .action:hover {
    background: var(--surface-2);
  }
</style>
