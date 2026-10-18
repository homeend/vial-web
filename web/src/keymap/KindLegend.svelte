<ul class="legend" aria-label="Key colours">
  <li><i class="normal"></i>normal key</li>
  <li><i class="mod"></i>modifier on hold</li>
  <li><i class="layer"></i>layer key</li>
  <li><i class="tap-dance"></i>tap dance</li>
  <li><i class="macro"></i>macro</li>
  <li><i class="transparent"></i>transparent (falls through)</li>
  <li><i class="combo"></i>part of a combo</li>
</ul>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    color: var(--text-2);
    font-size: 12px;
    list-style: none;
  }

  li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  i {
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--key-border);
    border-radius: 3px;
    background: var(--key-bg);
  }

  .mod {
    border-color: var(--tone-mod);
    background: color-mix(in srgb, var(--tone-mod) 25%, var(--key-bg));
  }

  .layer {
    border-color: var(--tone-layer);
    background: color-mix(in srgb, var(--tone-layer) 25%, var(--key-bg));
  }

  .tap-dance {
    border-color: var(--tone-tap-dance);
    background: color-mix(in srgb, var(--tone-tap-dance) 25%, var(--key-bg));
  }

  .macro {
    border-color: var(--tone-macro);
    background: color-mix(in srgb, var(--tone-macro) 25%, var(--key-bg));
  }

  .transparent {
    border-style: dashed;
    background: transparent;
  }

  .combo {
    box-shadow: inset 0 -3px 0 var(--combo);
  }
</style>
