<script lang="ts">
  import KeymapPage from "./keymap/KeymapPage.svelte";
  import { keyboard } from "./lib/keyboard.svelte";
  import Banner from "./shell/Banner.svelte";
  import Nav, { type Section } from "./shell/Nav.svelte";
  import Toasts from "./shell/Toasts.svelte";
  import TopBar from "./shell/TopBar.svelte";

  $effect(() => keyboard.start());

  // only the sections that are built; later phases add theirs
  const sections = $derived<Section[]>([{ id: "keymap", label: "Keymap", count: keyboard.model?.layers.length }]);
  let section = $state("keymap");

  const status = $derived(
    keyboard.link === "closed"
      ? "offline"
      : keyboard.link === "connecting" && !keyboard.model
        ? "connecting"
        : keyboard.connected
          ? "connected"
          : "disconnected",
  );
  // the loaded keyboard stays on screen, greyed out, while it can't be edited
  const blocked = $derived(keyboard.model !== null && status !== "connected");
</script>

<TopBar
  name={keyboard.model?.name ?? null}
  {status}
  fake={keyboard.session?.fake ?? false}
  languages={keyboard.languages}
  language={keyboard.language}
  onlanguage={(lang) => keyboard.setLanguage(lang)}
/>

<div class="shell">
  <Nav {sections} active={section} onselect={(id) => (section = id)} />

  <main class="content">
    {#if status === "offline"}
      <Banner tone="warning" title="Lost contact with Vial" message="Reconnecting… If this lasts, check that Vial is still running." />
    {:else if blocked}
      <Banner
        tone="danger"
        title="Keyboard unplugged"
        message="Changes are blocked until it is plugged back in. It is then read again."
      />
    {/if}
    {#if keyboard.loadError}
      <Banner
        tone="danger"
        title="Couldn't load the keyboard"
        message={keyboard.loadError}
        actionLabel="Try again"
        onaction={() => void keyboard.load()}
      />
    {/if}

    {#if keyboard.model}
      <div class="page" class:blocked inert={blocked}>
        <KeymapPage model={keyboard.model} />
      </div>
    {:else if status === "disconnected"}
      <div class="empty">
        <h1>No keyboard found</h1>
        <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
      </div>
    {:else if !keyboard.loadError}
      <div class="empty" aria-busy="true">
        <h1>Reading the keyboard…</h1>
      </div>
    {/if}
  </main>
</div>

<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    max-width: var(--shell-width);
    margin: 0 auto;
    padding: 16px var(--shell-gutter) 48px;
  }

  .content {
    display: grid;
    gap: 14px;
    min-width: 0;
    width: 100%;
    max-width: var(--content-max);
  }

  .page.blocked {
    filter: grayscale(1);
    opacity: 0.55;
  }

  .empty {
    padding: 64px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: 14px;
    text-align: center;
    color: var(--text-2);
  }

  .empty h1 {
    margin: 0 0 6px;
    color: var(--text);
    font-size: 18px;
  }

  .empty p {
    margin: 0;
  }

  @media (min-width: 1000px) {
    .shell {
      grid-template-columns: var(--nav-width) minmax(0, var(--content-max));
      gap: var(--shell-gap);
      padding-top: 24px;
    }
  }

  @media (max-width: 600px) {
    .shell {
      --shell-gutter: 12px;
    }
  }
</style>
