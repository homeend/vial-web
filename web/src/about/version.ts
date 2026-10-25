// What the Version page says about this Vial, from GET /api/version: the product and version, the executable or the
// checkout it runs from with its commit, the executable's build record, the system it runs on and where its files are.
import type { VersionInfo } from "../api/types";
import type { Fact } from "./about";

export interface VersionFact extends Fact {
  /** a page to open (the CI run) */
  href?: string;
}

export interface VersionGroup {
  title: string;
  facts: VersionFact[];
}

/** An ISO 8601 moment in the reader's time zone and language, with the day; "unknown" for none */
export function when(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "a1b2c3d4e5f6 on main", ", with local changes" when the tree differed from the commit */
function commitText(commit: string | null | undefined, branch: string | null | undefined,
                    dirty: boolean | null | undefined, unknown: string): string {
  if (!commit) return unknown;
  return `${commit.slice(0, 12)}${branch ? ` on ${branch}` : ""}${dirty ? ", with local changes" : ""}`;
}

/** The page's groups of facts */
export function versionFacts(info: VersionInfo): VersionGroup[] {
  const executable = info.kind === "executable";
  const vial: VersionFact[] = [
    { label: "Version", value: `${info.product} ${info.version}`, copy: true },
    executable
      ? { label: "Runs from", value: info.executable ?? "the executable", long: true, copy: true, code: true }
      : { label: "Runs from", value: `source, ${info.sourceRoot ?? "a checkout"}`, long: true, copy: true },
    { label: "Commit", value: commitText(info.commit, info.branch, info.dirty,
                                         executable ? "not recorded by this build" : "unknown (no git checkout)"),
      code: !!info.commit, copy: !!info.commit },
    { label: "Started", value: when(info.startedAt) },
    { label: "Keyboard", value: info.fake ? "simulated (--fake)" : "real hardware" },
  ];
  const groups: VersionGroup[] = [{ title: "Vial", facts: vial }];
  if (executable) {
    const build = info.build;
    groups.push({
      title: "Build",
      facts: build
        ? [
          { label: "Built", value: when(build.builtAt) },
          build.ciRun
            ? { label: "CI run", value: `${build.ciRun}${build.ciRef ? ` for ${build.ciRef}` : ""}${build.runner ? ` on ${build.runner}` : ""}`,
                href: build.ciUrl ?? undefined, copy: true }
            : { label: "CI run", value: "none: built by hand" },
          { label: "Built with", value: `Python ${build.builderPython}${build.pyinstaller ? `, PyInstaller ${build.pyinstaller}` : ""}` },
          { label: "Built on", value: build.builderSystem, long: true },
          { label: "Web UI built", value: when(build.webUiBuiltAt) },
        ]
        : [{ label: "Build record", value: "none: this executable was built before Vial kept one" }],
    });
  }
  groups.push({
    title: "This computer",
    facts: [
      { label: "System", value: info.system, long: true },
      { label: "Python", value: info.python },
      { label: "Data folder", value: info.dataDir ?? "none", long: true, copy: !!info.dataDir, code: !!info.dataDir },
      { label: "Log file", value: info.logFile ?? "none", long: true, copy: !!info.logFile, code: !!info.logFile },
    ],
  });
  return groups;
}

/** Every fact as text, for Copy all */
export function versionText(groups: VersionGroup[]): string {
  return groups.map((g) => [g.title, ...g.facts.map((f) => `  ${f.label}: ${f.value}${f.href ? ` (${f.href})` : ""}`)].join("\n"))
    .join("\n");
}
