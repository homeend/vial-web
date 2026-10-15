import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  // runes only: Svelte 4 syntax (export let, $:, on:click, slots) is a compile error
  compilerOptions: { runes: true },
};
