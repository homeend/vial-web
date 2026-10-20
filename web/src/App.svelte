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
  import LayoutPage from "./layout/LayoutPage.svelte";
  import { hasLighting } from "./lighting/lighting";
  import LightingPage from "./lighting/LightingPage.svelte";
  import MatrixPage from "./matrix/MatrixPage.svelte";
  import { keyboard } from "./lib/keyboard.svelte";
  import { asSentence, blockedWhy, chosenAway, keyboardOptions, shownKeyboard } from "./lib/keyboards";
  import type { SectionId } from "./lib/route";
  import { router } from "./lib/router.svelte";
  import { isWaiting } from "./lib/unlock.svelte";
  import { unsavedWork } from "./lib/unsaved";
  import Banner from "./shell/Banner.svelte";
  import Nav, { type Section } from "./shell/Nav.svelte";
  import Toasts from "./shell/Toasts.svelte";
  import TopBar from "./shell/TopBar.svelte";
  import UnlockDialog from "./shell/UnlockDialog.svelte";
  import SettingsPage from "./settings/SettingsPage.svelte";
  import ConfirmDialog from "./ui/ConfirmDialog.svelte";

  $effect(() => keyboard.start());
  $effect(() => router.start());

  // worked out once for every page, again after every edit
  const placement = $derived(keyboard.model ? placeKeyboard(keyboard.model) : null);
  const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
  const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);

  // sections the keyboard's firmware doesn't have (no layout options, tap dances, combos, macros, key overrides,
  // alt-repeat keys, QMK settings, lighting or matrix tester) are left out
  const sections = $derived.by<Section[]>(() => {
    const model = keyboard.model;
    const list: Section[] = [{ id: "keymap", label: "Keymap", count: model?.layers.length }];
    if (!model) return list;
    if (model.layoutOptions) list.push({ id: "layout", label: "Layout" });
    const counts = behaviourCounts(model);
    if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
    if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
    if (counts.macros !== null) list.push({ id: "macros", label: "Macros", count: counts.macros });
    if (counts.keyOverrides !== null) list.push({ id: "key-overrides", label: "Key overrides", count: counts.keyOverrides });
    if (counts.altRepeat !== null) list.push({ id: "alt-repeat", label: "Alt-repeat", count: counts.altRepeat });
    if (model.settings.length > 0) list.push({ id: "settings", label: "Settings" });
    if (hasLighting(model.lighting)) list.push({ id: "lighting", label: "Lighting" });
    if (model.matrixTester) list.push({ id: "matrix", label: "Matrix tester" });
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

  // the banner that says why the keyboard can't be edited, if any. The bootloader's takes the focus (BootloaderCard);
  // when it goes (the keyboard is back), the focus, which would fall to the page's body, goes to the page's heading.
  // This runs before the banner leaves the page, while it still has the focus. A keyboard that goes while a reboot
  // into the bootloader is on its way most likely went for it: the server says so before it answers.
  const inBootloader = $derived(keyboard.inBootloader || keyboard.rebooting);
  const why = $derived(
    status === "offline" ? "offline" : blocked && inBootloader ? "bootloader" : blocked ? "unplugged" : null,
  );
  $effect.pre(() => {
    void why;
    const banner = document.getElementById("bootloader-banner");
    if (!banner || banner !== document.activeElement) return;
    void tick().then(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body) document.getElementById(`${section}-title`)?.focus();
    });
  });

  // the keyboard selector, in the top bar when there are keyboards to choose from
  const keyboardChoices = $derived(keyboardOptions(keyboard.keyboards));
  const keyboardShown = $derived(keyboard.switching ?? shownKeyboard(keyboard.keyboards));
  /** the chosen keyboard while it is unplugged: waited for, as no other is opened instead */
  const away = $derived(chosenAway(keyboard.keyboards));
  const awayName = $derived(keyboardChoices.find((k) => k.id === away?.id)?.name ?? away?.name);
  const error = $derived(keyboard.session?.error ? asSentence(keyboard.session.error) : null);
  /** why the keyboard shown, greyed out, can't be changed: an error about another keyboard isn't about it */
  /** the USB device of the keyboard shown, as the keyboard list has it (for the Keyboard page's About card) */
  const shownUsb = $derived(keyboard.keyboards?.keyboards.find((k) => k.id === keyboard.modelKeyboard) ?? null);
  const blockedBy = $derived(blockedWhy(keyboard.session, keyboard.keyboards, keyboard.modelKeyboard));
  /** the keyboard being opened, by name, or null: the page (still the keyboard before) is greyed out meanwhile */
  const opening = $derived(
    keyboard.switching === null
      ? null
      : (keyboardChoices.find((k) => k.id === keyboard.switching)?.name ?? "the keyboard"),
  );
  const greyed = $derived(blocked || opening !== null);
  // the page goes inert while another keyboard is opened: the focus, if it was in it, would fall to the page's body;
  // it goes to the selector instead
  $effect.pre(() => {
    if (opening === null || !document.activeElement?.closest(".page")) return;
    void tick().then(() => document.getElementById("keyboard-select")?.focus());
  });

  /** another keyboard chosen while there is work not saved: the confirmation asks first */
  let asking = $state<{ id: string; title: string; message: string } | null>(null);

  function listed(items: string[]): string {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  }

  /** fromKeys: chosen with the keyboard on the closed select, where each arrow key chooses the next keyboard at once:
   * asked about first, as a pointer choice isn't */
  function chooseKeyboard(id: string, fromKeys: boolean) {
    const work = unsavedWork(keyboard.model);
    if (work.length === 0 && !fromKeys) {
      openKeyboard(id);
      return;
    }
    const name = keyboardChoices.find((k) => k.id === id)?.name ?? "that keyboard";
    const current = keyboard.keyboards?.keyboards.find((k) => k.id === keyboardShown);
    const currentName = keyboardChoices.find((k) => k.id === current?.id)?.name ?? "the keyboard shown";
    const what = current?.open
      ? `Vial closes ${currentName} and opens ${name}.`
      : current && !current.plugged
        ? `Vial opens ${name} instead of waiting for ${currentName} to be plugged back in.`
        : `Vial opens ${name}.`;
    asking = {
      id,
      title: `Switch to ${name}?`,
      message: work.length === 0 ? what : `${what} Not saved yet, and dropped if you switch: ${listed(work)}.`,
    };
  }

  // the work not saved is dropped by the store, once the server has switched (if it doesn't, nothing is lost)
  function openKeyboard(id: string) {
    void keyboard.selectKeyboard(id);
  }
</script>

<TopBar
  name={keyboard.model?.name ?? null}
  keyboards={keyboardChoices}
  keyboardId={keyboardShown}
  switching={keyboard.switching !== null}
  onkeyboard={chooseKeyboard}
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
    {#if opening !== null}
      <p class="opening" role="status" aria-busy="true">Opening {opening}…</p>
    {/if}
    {#if status === "offline"}
      <Banner tone="warning" title="Lost contact with Vial" message="Reconnecting… If this lasts, check that Vial is still running." />
    {:else if blocked && inBootloader}
      <Banner
        id="bootloader-banner"
        tone="warning"
        title={keyboard.bootloaderUnanswered
          ? "The keyboard has most likely rebooted into its bootloader"
          : "The keyboard is in its bootloader"}
        message="{keyboard.bootloaderUnanswered ? "It went without answering the reboot. " : ""}It usually doesn't work as a keyboard until it is flashed, or unplugged and plugged back in. It shows up here again then."
      />
    {:else if blocked && error && blockedBy === "list"}
      <Banner tone="danger" title="Vial couldn't look for keyboards" message="{error} Vial tries again by itself, about once a second." />
    {:else if blocked && error && blockedBy === "unread"}
      <Banner tone="danger" title="A keyboard was found, but couldn't be read" message="{error} Vial tries again by itself." />
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
      <!-- made anew for another keyboard, even one alike (the same uid): an editor open was for the one before -->
      {#key keyboard.opened}
        <div class="page" class:list={section !== "keymap"} class:blocked={greyed} inert={greyed}>
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
          {:else if section === "layout"}
            <LayoutPage model={keyboard.model} {placement} />
          {:else if section === "lighting"}
            <LightingPage model={keyboard.model} />
          {:else if section === "matrix"}
            <MatrixPage model={keyboard.model} {placement} />
          {:else if section === "keyboard"}
            <KeyboardPage model={keyboard.model} {analysis} usb={shownUsb} />
          {:else}
            <KeymapPage model={keyboard.model} {placement} {analysis} />
          {/if}
        </div>
      {/key}
    {:else if status === "disconnected" && isWaiting(unlock)}
      <div class="empty">
        <h1>The keyboard waits to be unlocked</h1>
        <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
      </div>
    {:else if status === "disconnected" && away}
      <div class="empty">
        <h1>{awayName} is unplugged</h1>
        <p>Vial opens it again as soon as it is plugged back in.</p>
        {#if keyboardChoices.length > 1}
          <p>To use another keyboard, choose it at the top of the page.</p>
        {/if}
      </div>
    {:else if status === "disconnected" && error}
      <div class="empty">
        {#if keyboard.session?.errorKind === "list"}
          <h1>Vial couldn't look for keyboards</h1>
          <p>{error}</p>
          <p>Vial tries again by itself, about once a second.</p>
        {:else}
          <h1>A keyboard was found, but couldn't be read</h1>
          <p>{error}</p>
          <p>Vial tries again by itself, and when it is plugged in again.</p>
        {/if}
      </div>
    {:else if status === "disconnected"}
      <div class="empty">
        <h1>No keyboard found</h1>
        <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
        {#if keyboard.session?.platform.startsWith("linux")}
          <p class="hint">
            Vial needs a udev rule to see keyboards:
            <a href="https://get.vial.today/manual/linux-udev.html" target="_blank" rel="noreferrer">how to add it</a>.
          </p>
        {/if}
      </div>
    {:else if !keyboard.loadError}
      <div class="empty" aria-busy="true">
        <h1>Reading the keyboard…</h1>
      </div>
    {/if}
  </main>
</div>

<UnlockDialog unlocker={keyboard.unlock} model={keyboard.model} {placement} {names} />
<ConfirmDialog
  open={asking !== null}
  title={asking?.title ?? ""}
  message={asking?.message ?? ""}
  confirmLabel="Switch keyboard"
  onconfirm={async () => {
    if (asking) openKeyboard(asking.id);
    return true;
  }}
  onclose={() => {
    asking = null;
    void tick().then(() => document.getElementById("keyboard-select")?.focus());
  }}
/>
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

  .opening {
    margin: 0;
    color: var(--text-2);
    font-size: 13.5px;
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
