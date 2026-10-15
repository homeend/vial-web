<script lang="ts">
  import type { KeyboardLanguage } from "../api/types";
  import ThemeSwitch from "./ThemeSwitch.svelte";

  interface Props {
    /** the keyboard's name, once loaded */
    name: string | null;
    status: "connected" | "disconnected" | "connecting" | "offline";
    fake: boolean;
    languages: KeyboardLanguage[];
    language: string;
    onlanguage: (lang: string) => void;
  }

  let { name, status, fake, languages, language, onlanguage }: Props = $props();

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
      {#if name}
        <span class="sep" aria-hidden="true">/</span>
        <span class="name">{name}</span>
      {/if}
    </div>

    <div class="right">
      {#if fake}
        <span class="badge fake" title="Started with --fake: nothing here touches a real keyboard">simulated keyboard</span>
      {/if}
      <span class="badge status {status}" role="status">
        <i aria-hidden="true"></i>{STATUS_TEXT[status]}
      </span>
      <ThemeSwitch />
      <label class="language">
        <span>Keyboard language</span>
        <select value={language} onchange={(e) => onlanguage(e.currentTarget.value)} disabled={languages.length === 0}>
          {#each languages as l (l.id)}
            <option value={l.id}>{l.name}</option>
          {/each}
        </select>
      </label>
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

  .language {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 12px;
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
