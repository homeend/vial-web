import { describe, expect, it } from "vitest";
import type { VersionInfo } from "../api/types";
import { versionFacts, versionText, when } from "./version";

const SOURCE: VersionInfo = {
  product: "Vial (web)", version: "1.1.0", kind: "source", executable: null, sourceRoot: "T:\\others\\vial-gui",
  commit: "89ca261f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d", branch: "learning-generator-links", dirty: true, build: null,
  python: "CPython 3.13.1", platform: "win32", system: "Windows-11-10.0.26200-SP0", startedAt: "2026-10-25T12:00:00Z",
  fake: true, dataDir: "C:\\Temp\\vial\\fake", logFile: "C:\\Temp\\vial\\fake\\vial.log",
};

const EXE: VersionInfo = {
  ...SOURCE, kind: "executable", executable: "C:\\Tools\\Vial.exe", sourceRoot: null, dirty: false, fake: false,
  build: {
    builtAt: "2026-10-25T11:00:00Z", commit: SOURCE.commit, branch: "main", dirty: false, ciRun: "123",
    ciUrl: "https://github.com/homeend/vial-web/actions/runs/123", ciRef: "v1.2.0", runner: "Windows",
    builderSystem: "Windows-10-10.0.20348-SP0", builderPython: "3.13.1", pyinstaller: "6.11.1",
    webUiBuiltAt: "2026-10-25T10:58:00Z",
  },
};

const byLabel = (info: VersionInfo) =>
  new Map(versionFacts(info).flatMap((g) => g.facts).map((f) => [f.label, f]));

describe("versionFacts", () => {
  it("from source: the checkout, its commit with the branch and local changes, no build group", () => {
    const groups = versionFacts(SOURCE);
    expect(groups.map((g) => g.title)).toEqual(["Vial", "This computer"]);
    const facts = byLabel(SOURCE);
    expect(facts.get("Version")).toMatchObject({ value: "Vial (web) 1.1.0", copy: true });
    expect(facts.get("Runs from")?.value).toBe("source, T:\\others\\vial-gui");
    expect(facts.get("Commit")).toMatchObject({ value: "89ca261f0a1b on learning-generator-links, with local changes", code: true, copy: true });
    expect(facts.get("Keyboard")?.value).toBe("simulated (--fake)");
    expect(facts.get("System")?.value).toBe("Windows-11-10.0.26200-SP0");
    expect(facts.get("Python")?.value).toBe("CPython 3.13.1");
    expect(facts.get("Data folder")).toMatchObject({ value: "C:\\Temp\\vial\\fake", copy: true, code: true });
    expect(facts.get("Log file")?.value).toBe("C:\\Temp\\vial\\fake\\vial.log");
    expect(facts.get("Started")?.value).toMatch(/2026/);
  });

  it("the executable: its path, the build record with a link to the CI run", () => {
    const groups = versionFacts(EXE);
    expect(groups.map((g) => g.title)).toEqual(["Vial", "Build", "This computer"]);
    const facts = byLabel(EXE);
    expect(facts.get("Runs from")).toMatchObject({ value: "C:\\Tools\\Vial.exe", code: true, copy: true });
    expect(facts.get("Commit")?.value).toBe("89ca261f0a1b on learning-generator-links");
    expect(facts.get("Keyboard")?.value).toBe("real hardware");
    expect(facts.get("Built")?.value).toMatch(/2026/);
    expect(facts.get("CI run")).toMatchObject({ value: "123 for v1.2.0 on Windows", href: "https://github.com/homeend/vial-web/actions/runs/123" });
    expect(facts.get("Built with")?.value).toBe("Python 3.13.1, PyInstaller 6.11.1");
    expect(facts.get("Built on")?.value).toBe("Windows-10-10.0.20348-SP0");
    expect(facts.get("Web UI built")?.value).toMatch(/2026/);
  });

  it("an executable without a record, built by hand, or without git", () => {
    const old = byLabel({ ...EXE, build: null, commit: null, branch: null, dirty: null });
    expect(old.get("Commit")?.value).toBe("not recorded by this build");
    expect(old.get("Build record")?.value).toMatch(/^none: /);
    const byHand = byLabel({ ...EXE, build: { ...EXE.build!, ciRun: null, ciUrl: null, ciRef: null, runner: null, pyinstaller: null } });
    expect(byHand.get("CI run")).toEqual({ label: "CI run", value: "none: built by hand" });
    expect(byHand.get("Built with")?.value).toBe("Python 3.13.1");
    const noGit = byLabel({ ...SOURCE, commit: null, branch: null, dirty: null, dataDir: null, logFile: null });
    expect(noGit.get("Commit")).toMatchObject({ value: "unknown (no git checkout)", code: false, copy: false });
    expect(noGit.get("Data folder")).toMatchObject({ value: "none", copy: false });
  });
});

describe("when", () => {
  it("shows a moment in the reader's locale, and says so for none", () => {
    expect(when("2026-10-25T12:00:00Z")).toMatch(/2026/);
    expect(when(null)).toBe("unknown");
    expect(when("not a date")).toBe("not a date");
  });
});

describe("versionText", () => {
  it("lists every group and fact, a link in brackets", () => {
    const text = versionText(versionFacts(EXE));
    expect(text.startsWith("Vial\n  Version: Vial (web) 1.1.0\n")).toBe(true);
    expect(text).toContain("\nBuild\n");
    expect(text).toContain("  CI run: 123 for v1.2.0 on Windows (https://github.com/homeend/vial-web/actions/runs/123)");
    expect(text).toContain("\nThis computer\n  System: ");
  });
});
