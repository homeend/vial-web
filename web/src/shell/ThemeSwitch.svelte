<script lang="ts">
  import { applyTheme, browserStorage, readTheme, saveTheme, THEME_CHOICES, type ThemeChoice } from "../lib/theme";

  // index.html has already applied the saved choice before the first paint
  let choice = $state<ThemeChoice>(readTheme(browserStorage()));

  function choose(next: ThemeChoice) {
    choice = next;
    applyTheme(document.documentElement, next);
    saveTheme(browserStorage(), next);
  }
</script>

<fieldset class="theme">
  <legend class="visually-hidden">Theme</legend>
  {#each THEME_CHOICES as c (c.value)}
    <label class:on={choice === c.value}>
      <input
        type="radio"
        name="theme"
        value={c.value}
        checked={choice === c.value}
        onchange={() => choose(c.value)}
      />
      {c.label}
    </label>
  {/each}
</fieldset>

<style>
  .theme {
    display: inline-flex;
    gap: 2px;
    margin: 0;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
  }

  label {
    position: relative;
    padding: 3px 9px;
    border-radius: 7px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
  }

  label:hover {
    color: var(--text);
  }

  label.on {
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* the radio button covers its label, invisibly */
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
