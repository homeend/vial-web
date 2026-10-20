// Work not saved yet, which opening another keyboard would drop: asked about before the keyboard selector switches
// (App.svelte asks for a confirmation then). The editors open on the pages that show (a combo, a macro, a key override,
// an alt-repeat key being edited) say what they have while they track it; the Settings page's changes and the lighting
// not saved are kept while another page shows, so they are asked about wherever they were made.
import type { KeyboardModel } from "../api/types";
import { lightingBaseline } from "../lighting/state.svelte";
import { matrixTest } from "../matrix/state.svelte";
import { settingsEdits } from "../settings/state.svelte";

/** What a page has open and not saved, as the confirmation names it ("the combo being edited"); null for nothing */
export type Draft = () => string | null;

const drafts = new Set<Draft>();

/** Track a page's work not saved while the page shows: the function returned stops (an $effect's cleanup) */
export function trackDraft(draft: Draft): () => void {
  drafts.add(draft);
  return () => {
    drafts.delete(draft);
  };
}

/** What isn't saved yet, for the keyboard shown (`model`) */
export function unsavedWork(model: KeyboardModel | null): string[] {
  const work: string[] = [];
  for (const draft of drafts) {
    const what = draft();
    if (what) work.push(what);
  }
  if (model) {
    if (settingsEdits.keptFor(model.uid)) work.push("the changes on the Settings page");
    if (lightingBaseline.unsavedFor(model.uid, model.lighting)) {
      work.push("the lighting changes (the keyboard shows them until it is unplugged)");
    }
  }
  return work;
}

/** Another keyboard is shown (KeyboardStore calls it): the Settings page's changes, the lighting followed and the keys
 * the matrix tester saw pressed are forgotten, so that they aren't taken for the next keyboard's, even one alike (with
 * the same uid). The pages' editors go with the pages (App.svelte makes them anew). */
export function dropUnsavedWork(): void {
  settingsEdits.forget();
  lightingBaseline.forget();
  matrixTest.forget();
}
