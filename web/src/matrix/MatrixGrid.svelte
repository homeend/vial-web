<script lang="ts">
  import type { MatrixCell } from "./matrix";

  interface Props {
    cells: MatrixCell[][];
  }

  let { cells }: Props = $props();
  const uid = $props.id();

  const STATES = { held: "held now", tested: "pressed before", untested: "not pressed yet" } as const;
  const cols = $derived(cells[0]?.length ?? 0);
</script>

<!-- the switch matrix as the firmware reads it: every row and column, keys of the layout or not -->
<div class="scroll">
  <table aria-describedby="{uid}-legend">
    <thead>
      <tr>
        <td></td>
        {#each Array.from({ length: cols }, (_, c) => c) as col (col)}
          <th scope="col"><span class="visually-hidden">Column </span>{col}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each cells as row, r (r)}
        <tr>
          <th scope="row"><span class="visually-hidden">Row </span>{r}</th>
          {#each row as cell (cell.col)}
            <td>
              <span class="cell {cell.state}" class:nokey={!cell.inLayout}>
                <span class="visually-hidden">{cell.inLayout ? "" : "no key in the layout, "}{STATES[cell.state]}</span>
              </span>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<ul class="legend" id="{uid}-legend">
  <li><span class="cell untested" aria-hidden="true"></span> a key, not pressed yet</li>
  <li><span class="cell tested" aria-hidden="true"></span> pressed before</li>
  <li><span class="cell held" aria-hidden="true"></span> held now</li>
  <li><span class="cell untested nokey" aria-hidden="true"></span> no key in the layout</li>
</ul>

<style>
  /* a wide matrix scrolls on its own; the page never does */
  .scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    border-collapse: separate;
    border-spacing: 4px;
    margin: 0 auto;
  }

  th {
    min-width: 18px;
    color: var(--text-2);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 550;
  }

  td {
    padding: 0;
  }

  .cell {
    position: relative;
    display: block;
    width: 22px;
    height: 22px;
    border: 2px solid var(--key-border);
    border-radius: 5px;
    background: var(--key-bg);
  }

  .cell.tested {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 22%, var(--key-bg));
  }

  /* a dot: pressed before, told by shape as well as colour */
  .cell.tested::after {
    content: "";
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--ok);
  }

  .cell.held {
    border-color: var(--accent);
    background: var(--accent);
  }

  /* no key there: dashed, as the keymap draws an empty key */
  .cell.nokey {
    border-style: dashed;
    background: transparent;
  }

  .cell.nokey.tested {
    background: color-mix(in srgb, var(--ok) 22%, transparent);
  }

  /* filled inside its dashed border only: held, it still looks unlike a key */
  .cell.nokey.held {
    background: var(--accent);
    background-clip: padding-box;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    color: var(--text-2);
    font-size: 12.5px;
    list-style: none;
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend .cell {
    width: 16px;
    height: 16px;
  }

  .legend .cell.tested::after {
    inset: 3px;
  }
</style>
