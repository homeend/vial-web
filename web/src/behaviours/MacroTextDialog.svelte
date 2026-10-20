<script lang="ts">
  // A macro's steps as text, as Qt's text editor has them ("Open Text Editor..." on its Macros tab): JSON that copies
  // between the two. Apply puts the steps in the macro being edited; the page's Save writes them to the keyboard.
  import { tick } from "svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    /** whether it shows */
    open: boolean;
    /** the macro's number */
    index: number;
    /** the steps being edited, as text: what the box starts with */
    text: string;
    /** reads the text into the macro being edited: null when it was, else what is wrong (the dialog stays open) */
    onapply: (text: string) => Promise<string | null>;
    /** closed, applied or not: the caller gives the focus back to whatever opened it */
    onclose: () => void;
  }

  let { open, index, text, onapply, onclose }: Props = $props();

  /** the most text the server reads (schemas.MACRO_TEXT_MAX characters), and so the most a file loaded may hold */
  const MAX_TEXT = 16 * 0xffff;
  /** ... said in whole KiB */
  const MAX_KIB = Math.floor(MAX_TEXT / 1024);

  let dialog = $state<HTMLDialogElement>();
  let box = $state<HTMLTextAreaElement>();
  let fileInput = $state<HTMLInputElement>();
  let value = $state("");
  /** why Apply didn't take the text, or why a file couldn't be loaded */
  let problem = $state<string | null>(null);
  /** what was done last (copied, loaded, saved), said for screen readers too */
  let done = $state("");
  let working = $state(false);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      value = text;
      problem = null;
      done = "";
      working = false;
      dialog.showModal();
      void tick().then(() => {
        box?.focus();
        box?.setSelectionRange(0, 0);
      });
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  async function apply() {
    if (working) return;
    done = "";
    // checked here: the server would refuse it with a message of its own that isn't about the text
    if (value.length > MAX_TEXT) {
      problem = `The text wasn't applied: it is too long for a macro (at most ${MAX_KIB} KiB).`;
      box?.focus();
      return;
    }
    working = true;
    let result: string | null;
    try {
      result = await onapply(value);
    } finally {
      working = false;
    }
    // closed meanwhile (a second Esc closes it, whatever the page says): the text was dropped (onapply doesn't use
    // it then), and nothing is said
    if (!dialog?.open) return;
    problem = result;
    if (problem === null) dialog.close();
    else box?.focus();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      done = "Copied the text.";
    } catch {
      selectAll();
      done = "The browser didn't allow copying: the text is selected, copy it with Ctrl+C.";
    }
  }

  function selectAll() {
    box?.focus();
    box?.select();
  }

  /** Saves the text as a .vim file, as Qt's text editor does ("Vial macro") */
  function saveFile() {
    const name = `macro-${index}.vim`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([value], { type: "text/plain" }));
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    done = `Saved ${name}.`;
  }

  /** Reads a file into the box; Apply then takes it */
  async function loadFile(file: File) {
    done = "";
    if (file.size > MAX_TEXT) {
      problem = `${file.name} can't be loaded: it is too large for a macro (at most ${MAX_KIB} KiB).`;
      return;
    }
    try {
      value = await file.text();
      problem = null;
      done = `Loaded ${file.name}: Apply puts its steps in the macro.`;
      box?.focus();
    } catch {
      problem = `${file.name} can't be loaded: the browser couldn't read it.`;
    }
  }

  /** the physical keys of the shortcuts, for a layout whose letters aren't Latin (Cyrillic, Greek...) */
  const SHORTCUT_CODES: Record<string, string> = { KeyS: "s", KeyO: "o" };

  /** Ctrl+S saves the text as a file and Ctrl+O loads one, as in Qt's text editor: by the letter typed, or by the
   * key where S or O is on a Latin layout when the letter typed isn't Latin */
  function onkeydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : SHORTCUT_CODES[event.code];
    if (key === "s") {
      event.preventDefault();
      saveFile();
    } else if (key === "o") {
      event.preventDefault();
      fileInput?.click();
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="text-dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-about"
  oncancel={(event) => {
    // Esc waits for the text being read, as Cancel does
    if (working) event.preventDefault();
  }}
  onclose={onclose}
  {onkeydown}
>
  <h2 id="{uid}-title">Macro {index} as text</h2>
  <p id="{uid}-about" class="about">
    Its steps as JSON, as the Vial desktop app's text editor writes them: text copies from one to the other. Apply puts
    these steps in place of the ones being edited; the page's Save then writes them to the keyboard. Ctrl+S saves the
    text as a file, Ctrl+O loads one.
  </p>
  <textarea
    bind:this={box}
    bind:value
    aria-label="Macro {index} as text"
    aria-invalid={problem !== null}
    aria-describedby={problem !== null ? `${uid}-problem` : undefined}
    spellcheck="false"
    autocomplete="off"
    rows="10"
    readonly={working}
  ></textarea>
  {#if problem !== null}<p id="{uid}-problem" class="problem" role="alert">{problem}</p>{/if}
  <p class="done" role="status">{done}</p>
  <div class="buttons">
    <div class="tools">
      <Button size="sm" onclick={() => void copy()}>Copy</Button>
      <Button size="sm" onclick={selectAll}>Select all</Button>
      <Button size="sm" title="Ctrl+S" onclick={saveFile}>Save as file…</Button>
      <Button size="sm" title="Ctrl+O" onclick={() => fileInput?.click()}>Load file…</Button>
      <input
        bind:this={fileInput}
        class="visually-hidden"
        type="file"
        accept=".vim,.json,.txt,text/plain,application/json"
        tabindex="-1"
        aria-label="Macro file to load"
        onchange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void loadFile(file);
        }}
      />
    </div>
    <div class="answer">
      <Button aria-disabled={working || undefined} onclick={() => {
        if (!working) dialog?.close();
      }}>Cancel</Button>
      <Button variant="primary" aria-disabled={working || undefined} onclick={() => void apply()}>
        {working ? "Apply…" : "Apply"}
      </Button>
    </div>
  </div>
</dialog>

<style>
  .text-dialog {
    width: min(720px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100vh - 32px);
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .text-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 17px;
  }

  .about {
    margin: 0 0 12px;
    color: var(--text-2);
    font-size: 13px;
  }

  textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 8em;
    max-height: 50vh;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--board-bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    resize: vertical;
  }

  textarea[aria-invalid="true"] {
    border-color: var(--danger);
  }

  .problem {
    margin: 8px 0 0;
    color: var(--danger);
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .done {
    min-height: 1.4em;
    margin: 6px 0 0;
    color: var(--text-3);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 8px;
  }

  .tools,
  .answer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .answer {
    gap: 8px;
    margin-left: auto;
  }
</style>
