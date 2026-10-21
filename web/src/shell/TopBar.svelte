<script lang="ts">
  import { tick } from "svelte";
  import type { KeyboardLanguage } from "../api/types";
  import type { KeyboardOption } from "../lib/keyboards";
  import ThemeSwitch from "./ThemeSwitch.svelte";

  interface Props {
    /** the keyboard's name, once loaded */
    name: string | null;
    /** the keyboards to choose from: the selector takes the name's place when there is more than one */
    keyboards: KeyboardOption[];
    /** the keyboard the selector shows (KeyboardOption.id), "" for none */
    keyboardId: string;
    /** a keyboard is being opened: the selector takes no other choice meanwhile */
    switching: boolean;
    /** another keyboard was chosen (the selector keeps showing keyboardId: whoever opens it changes that). fromKeys:
     * with a key on the select (an arrow key, a letter...), which chooses at once when it is closed */
    onkeyboard: (id: string, fromKeys: boolean) => void;
    status: "connected" | "disconnected" | "connecting" | "offline";
    fake: boolean;
    languages: KeyboardLanguage[];
    language: string;
    onlanguage: (lang: string) => void;
    /** whether the keyboard is locked or unlocked; null while there is none to lock or unlock */
    lock: "locked" | "unlocked" | null;
    /** an unlock or a lock is being sent */
    lockBusy: boolean;
    /** the unlock dialog shows */
    unlockOpen: boolean;
    onunlock: () => void;
    onlock: () => void;
    /** Quit Vial is on its way to the server */
    quitting: boolean;
    /** Quit Vial was pressed */
    onquit: () => void;
  }

  let {
    name, keyboards, keyboardId, switching, onkeyboard, status, fake, languages, language, onlanguage, lock, lockBusy,
    unlockOpen, onunlock, onlock, quitting, onquit,
  }: Props = $props();

  const shownKeyboard = $derived(keyboards.find((k) => k.id === keyboardId));

  let nameShown = $state<HTMLElement>();
  // the selector goes while it has the focus (a keyboard unplugged leaves one to choose from): the focus, which would
  // fall to the page's body, goes to the keyboard's name in its place, else to the page's main heading. This runs
  // before the selector leaves the page.
  $effect.pre(() => {
    if (keyboards.length > 1) return;
    const select = document.getElementById("keyboard-select");
    if (!select || select !== document.activeElement) return;
    void tick().then(() => {
      const focused = document.activeElement;
      if (focused && focused !== document.body) return;
      const heading = document.querySelector<HTMLElement>("main h1");
      if (!nameShown && heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      (nameShown ?? heading)?.focus();
    });
  });

  /** when a key that moves the choice was last pressed on the selector (event time stamp), or null */
  let keyedAt: number | null = null;
  /** a change this soon after such a key comes from it. Firefox's open list sends the select no pointerdown: arrows in
   * the open list, then a pick with the mouse within this time, is asked about as a keyed choice. Asking once too
   * often is harmless, so it is left so. */
  const KEYED_WITHIN = 500;

  function keyOnSelector(event: KeyboardEvent) {
    // Alt+arrow opens the list instead: a choice made in it is made on purpose
    const moves = !event.altKey && !event.ctrlKey && !event.metaKey && (event.key.length === 1 && event.key !== " "
      || ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key));
    keyedAt = moves ? event.timeStamp : null;
  }

  function chooseKeyboard(event: Event & { currentTarget: HTMLSelectElement }) {
    const select = event.currentTarget;
    const id = select.value;
    const fromKeys = keyedAt !== null && event.timeStamp - keyedAt < KEYED_WITHIN;
    keyedAt = null;
    // it shows keyboardId until that changes: a choice may be asked about first, or refused while switching
    select.value = keyboardId;
    if (!switching && id !== keyboardId) onkeyboard(id, fromKeys);
  }

  let lockButton = $state<HTMLButtonElement>();
  /** the lock button was pressed: it is disabled while its request is sent, and the unlock dialog may show, so the
   * focus falls to the page. It gets the focus back once both are done (unless the user moved it meanwhile). */
  let returnFocus = $state(false);

  $effect(() => {
    if (!returnFocus || lockBusy || unlockOpen) return;
    returnFocus = false;
    void tick().then(() => {
      const focused = document.activeElement;
      if ((!focused || focused === document.body) && !document.querySelector("dialog[open]")) lockButton?.focus();
    });
  });

  function pressLock() {
    returnFocus = true;
    if (lock === "unlocked") onlock();
    else onunlock();
  }

  const STATUS_TEXT = {
    connected: "Connected",
    disconnected: "Keyboard unplugged",
    connecting: "Connecting…",
    offline: "Vial not running",
  };
</script>

<header class="topbar">
  <div class="inner">
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
        <path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0.01M7 14h10" />
      </svg>
      <span class="app">Vial</span>
      {#if keyboards.length > 1}
        <span class="sep" aria-hidden="true">/</span>
        <label class="keyboard">
          <span class="visually-hidden">Keyboard</span>
          <select id="keyboard-select" value={keyboardId} title={shownKeyboard?.full} aria-busy={switching || undefined}
            onkeydown={keyOnSelector} onpointerdown={() => (keyedAt = null)} onchange={chooseKeyboard}>
            {#if !shownKeyboard}
              <option value="" disabled>Choose a keyboard</option>
            {/if}
            {#each keyboards as k (k.id)}
              <option value={k.id} title={k.full}>{k.label}</option>
            {/each}
          </select>
        </label>
      {:else if name}
        <span class="sep" aria-hidden="true">/</span>
        <!-- focusable from code only: it takes the focus when the selector goes while it has it -->
        <span class="name" tabindex="-1" bind:this={nameShown}>{name}</span>
      {/if}
    </div>

    <div class="right">
      {#if fake}
        <span class="badge fake" title="Started with --fake: nothing here touches a real keyboard">simulated keyboard</span>
      {/if}
      <span class="badge status {status}" role="status">
        <i aria-hidden="true"></i>{STATUS_TEXT[status]}
      </span>
      {#if lock}
        <!-- next to the connection: what the keyboard lets Vial change -->
        <button
          bind:this={lockButton}
          type="button"
          class="badge lock {lock}"
          disabled={lockBusy}
          aria-label={lock === "unlocked" ? "Keyboard unlocked: lock it" : "Keyboard locked: unlock it"}
          title={lock === "unlocked"
            ? "Unlocked: macros and the bootloader key can be changed. Click to lock it again."
            : "Locked: changing macros or the bootloader key needs it unlocked. Click to unlock it."}
          onclick={pressLock}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d={lock === "unlocked" ? "M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" : "M5.5 7V5a2.5 2.5 0 0 1 5 0v2"} />
          </svg>
          {lock === "unlocked" ? "Unlocked" : "Locked"}
        </button>
      {/if}
      <ThemeSwitch />
      <label class="language">
        <span>Keyboard language</span>
        <select value={language} onchange={(e) => onlanguage(e.currentTarget.value)} disabled={languages.length === 0}>
          {#each languages as l (l.id)}
            <option value={l.id}>{l.name}</option>
          {/each}
        </select>
      </label>
      <!-- here on every page, with or without a keyboard: stopping Vial is about the app, not one keyboard -->
      <button
        id="quit-button"
        type="button"
        class="quit"
        aria-disabled={quitting || undefined}
        title="Stop Vial: it lets go of the keyboard and exits"
        onclick={() => {
          if (!quitting) onquit();
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5v5" />
          <path d="M4.7 4.6a4.6 4.6 0 1 0 6.6 0" />
        </svg>
        {quitting ? "Quitting…" : "Quit Vial"}
      </button>
    </div>
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(8px);
  }

  .inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    max-width: var(--shell-width);
    margin: 0 auto;
    padding: 10px var(--shell-gutter);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .logo {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.7;
    stroke-linecap: round;
  }

  .app {
    font-size: 16px;
    font-weight: 750;
    letter-spacing: -0.01em;
  }

  .sep {
    color: var(--text-3);
  }

  .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keyboard {
    display: flex;
    min-width: 0;
  }

  .keyboard select {
    min-width: 0;
    max-width: min(320px, calc(100vw - 150px));
    padding: 4px 6px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keyboard select[aria-busy="true"] {
    cursor: progress;
  }

  .right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .fake {
    border-color: color-mix(in srgb, var(--badge) 45%, transparent);
    background: color-mix(in srgb, var(--badge) 12%, transparent);
    color: var(--badge);
  }

  .status i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .status.connected i {
    background: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent);
  }

  .status.disconnected i,
  .status.offline i {
    background: var(--danger);
  }

  .lock {
    cursor: pointer;
  }

  .lock:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .lock.unlocked {
    border-color: color-mix(in srgb, var(--warning-text) 40%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .lock:disabled {
    cursor: progress;
    opacity: 0.6;
  }

  .lock svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .language {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 12px;
  }

  .quit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .quit:hover {
    border-color: color-mix(in srgb, var(--danger) 55%, transparent);
    color: var(--danger);
  }

  .quit[aria-disabled="true"] {
    cursor: progress;
    opacity: 0.6;
  }

  .quit svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .language select {
    max-width: 210px;
    padding: 4px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 13px;
  }
</style>
