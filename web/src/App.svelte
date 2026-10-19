<script lang="ts">
  import { tick, untrack } from "svelte";
  import KeyboardPage from "./about/KeyboardPage.svelte";
  import { analyse } from "./analysis/analysis";
  import AltRepeatPage from "./behaviours/AltRepeatPage.svelte";
  import CombosPage from "./behaviours/CombosPage.svelte";
  import { behaviourCounts } from "./behaviours/entries";
  import KeyOverridesPage from "./behaviours/KeyOverridesPage.svelte";
  import MacrosPage from "./behaviours/MacrosPage.svelte";
  import TapDancePage from "./behaviours/TapDancePage.svelte";
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
  import SettingsPage from "./settings/SettingsPage.svelte";

  $effect(() => keyboard.start());
  $effect(() => router.start());

  // worked out once for every page, again after every edit
  const placement = $derived(keyboard.model ? placeKeyboard(keyboard.model) : null);
  const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
  const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);

  // sections the keyboard's firmware doesn't have (no tap dances, combos, macros, key overrides, alt-repeat keys or
  // QMK settings) are left out
  const sections = $derived.by<Section[]>(() => {
    const model = keyboard.model;
    const list: Section[] = [{ id: "keymap", label: "Keymap", count: model?.layers.length }];
    if (!model) return list;
    const counts = behaviourCounts(model);
    if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
    if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
    if (counts.macros !== null) list.push({ id: "macros", label: "Macros", count: counts.macros });
    if (counts.keyOverrides !== null) list.push({ id: "key-overrides", label: "Key overrides", count: counts.keyOverrides });
    if (counts.altRepeat !== null) list.push({ id: "alt-repeat", label: "Alt-repeat", count: counts.altRepeat });
    if (model.settings.length > 0) list.push({ id: "settings", label: "Settings" });
    list.push({ id: "keyboard", label: "Keyboard" });
    return list;
  });
  // a section this keyboard doesn't have shows the keymap
  const section = $derived<SectionId>(
    sections.some((s) => s.id === router.route.section) ? router.route.section : "keymap",
  );
  // ... and the address says so, once the keyboard is read (before, no section but the keymap is known)
  $effect(() => {
    if (keyboard.model && router.route.section !== section) untrack(() => router.go(section, null, { replace: true }));
  });

  $effect(() => {
    document.title = `${sections.find((s) => s.id === section)?.label ?? "Keymap"} · Vial`;
  });

  // another page shown from the address (the back or forward button): the focus, which was on the page that went,
  // goes to the new page's heading. A card the address names takes it itself (useTarget).
  let sectionShown: SectionId | null = null;
  $effect(() => {
    const now = section;
    untrack(() => {
      const before = sectionShown;
      sectionShown = now;
      if (before === null || before === now || !router.fromAddress || router.route.item !== null) return;
      void tick().then(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body) document.getElementById(`${now}-title`)?.focus();
      });
    });
  });

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
  unlockOpen={keyboard.unlock.open}
  onunlock={() => void keyboard.unlock.start()}
  onlock={() => void keyboard.unlock.lock()}
/>

<div class="shell">
  <Nav {sections} active={section} onselect={(id) => router.go(id)} />

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
      <div class="page" class:list={section !== "keymap"} class:blocked inert={blocked}>
        {#if section === "tap-dance"}
          <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
        {:else if section === "combos"}
          <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
        {:else if section === "macros"}
          <MacrosPage model={keyboard.model} {analysis} item={router.route.item} />
        {:else if section === "key-overrides"}
          <KeyOverridesPage model={keyboard.model} item={router.route.item} />
        {:else if section === "alt-repeat"}
          <AltRepeatPage model={keyboard.model} item={router.route.item} />
        {:else if section === "settings"}
          <SettingsPage model={keyboard.model} />
        {:else if section === "keyboard"}
          <KeyboardPage model={keyboard.model} {analysis} />
        {:else}
          <KeymapPage model={keyboard.model} {placement} {analysis} />
        {/if}
      </div>
    {:else if status === "disconnected" && isWaiting(unlock)}
      <div class="empty">
        <h1>The keyboard waits to be unlocked</h1>
        <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
      </div>
    {:else if status === "disconnected" && keyboard.session?.error}
      <div class="empty">
        <h1>A keyboard was found, but couldn't be read</h1>
        <p>{keyboard.session.error}</p>
        <p>Vial tries again by itself, and when it is plugged in again.</p>
      </div>
    {:else if status === "disconnected"}
      <div class="empty">
        <h1>No keyboard found</h1>
        <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
        <p class="hint">
          On Linux, Vial needs a udev rule to see keyboards:
          <a href="https://get.vial.today/manual/linux-udev.html" target="_blank" rel="noreferrer">how to add it</a>.
        </p>
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
    align-content: start;
    gap: 14px;
    min-width: 0;
    width: 100%;
    max-width: var(--content-max);
  }

  /* list pages (all but the keymap) are narrower than the keymap, centred in its column */
  .page.list {
    width: 100%;
    max-width: var(--list-max);
    margin: 0 auto;
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

  .empty p + p {
    margin-top: 6px;
  }

  .empty .hint {
    font-size: 13px;
  }

  .empty a {
    color: var(--accent);
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
