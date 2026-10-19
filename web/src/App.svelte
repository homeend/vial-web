<script lang="ts">
  import { analyse } from "./analysis/analysis";
  import { placeKeyboard } from "./keyboard/geometry";
  import { namesOf } from "./keyboard/labels";
  import KeymapPage from "./keymap/KeymapPage.svelte";
  import { keyboard } from "./lib/keyboard.svelte";
  import type { SectionId } from "./lib/route";
  import { router } from "./lib/router.svelte";
  import { isWaiting } from "./lib/unlock.svelte";
  import Banner from "./shell/Banner.svelte";
  import Nav, { type Section } from "./shell/Nav.svelte";
  import Toasts from "./shell/Toasts.svelte";
  import TopBar from "./shell/TopBar.svelte";
  import UnlockDialog from "./shell/UnlockDialog.svelte";

  $effect(() => keyboard.start());
  $effect(() => router.start());

  // worked out once for every page, again after every edit
  const placement = $derived(keyboard.model ? placeKeyboard(keyboard.model) : null);
  const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
  const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);

  // only the sections that are built; later tasks add theirs
  const sections = $derived<Section[]>([{ id: "keymap", label: "Keymap", count: keyboard.model?.layers.length }]);
  // a section this keyboard doesn't have shows the keymap
  const section = $derived<SectionId>(
    sections.some((s) => s.id === router.route.section) ? router.route.section : "keymap",
  );

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
  const unlock = $derived(keyboard.unlock.state);
  const lock = $derived(
    status !== "connected" || !keyboard.model ? null : unlock.state === "unlocked" ? "unlocked" : "locked",
  );
</script>

<TopBar
  name={keyboard.model?.name ?? null}
  {status}
  fake={keyboard.session?.fake ?? false}
  languages={keyboard.languages}
  language={keyboard.language}
  onlanguage={(lang) => keyboard.setLanguage(lang)}
  {lock}
  lockBusy={keyboard.unlock.busy}
  onunlock={() => void keyboard.unlock.unlock()}
  onlock={() => void keyboard.unlock.lock()}
/>

<div class="shell">
  <Nav {sections} active={section} onselect={(id) => router.go(id as SectionId)} />

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
    {#if unlock.state === "cancelled"}
      <Banner
        tone="warning"
        title="The keyboard still waits to be unlocked"
        message="It takes no changes until its unlock keys are held, or it is unplugged and plugged back in."
        actionLabel="Unlock"
        onaction={() => void keyboard.unlock.start()}
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

    {#if keyboard.model && placement && analysis}
      <div class="page" class:blocked inert={blocked}>
        <KeymapPage model={keyboard.model} {placement} {analysis} />
      </div>
    {:else if status === "disconnected" && isWaiting(unlock)}
      <div class="empty">
        <h1>The keyboard waits to be unlocked</h1>
        <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
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

<UnlockDialog unlocker={keyboard.unlock} model={keyboard.model} {placement} {names} />
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
