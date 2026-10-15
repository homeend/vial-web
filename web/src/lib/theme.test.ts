import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";
import { applyTheme, readTheme, saveTheme, THEME_KEY, type ThemeRoot, type ThemeStorage } from "./theme";

function storage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: ThemeStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

function root(): ThemeRoot & { attributes: Record<string, string> } {
  const attributes: Record<string, string> = {};
  return {
    attributes,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    },
  };
}

describe("readTheme", () => {
  it("is the saved choice", () => {
    expect(readTheme(storage({ [THEME_KEY]: "dark" }))).toBe("dark");
    expect(readTheme(storage({ [THEME_KEY]: "light" }))).toBe("light");
  });

  it("follows the system when nothing, or something unknown, is saved", () => {
    expect(readTheme(storage())).toBe("system");
    expect(readTheme(storage({ [THEME_KEY]: "purple" }))).toBe("system");
  });

  it("follows the system when the storage can't be read", () => {
    expect(readTheme(broken)).toBe("system");
    expect(readTheme(null)).toBe("system");
  });
});

describe("saveTheme", () => {
  it("remembers the choice", () => {
    const s = storage();
    expect(saveTheme(s, "dark")).toBe(true);
    expect(s.data[THEME_KEY]).toBe("dark");
  });

  it("says when it can't remember it", () => {
    expect(saveTheme(broken, "dark")).toBe(false);
    expect(saveTheme(null, "dark")).toBe(false);
  });
});

describe("applyTheme", () => {
  it("sets data-theme for light and dark", () => {
    const r = root();
    applyTheme(r, "dark");
    expect(r.attributes["data-theme"]).toBe("dark");
    applyTheme(r, "light");
    expect(r.attributes["data-theme"]).toBe("light");
  });

  it("removes it for the system's theme, so the colour-scheme media query decides", () => {
    const r = root();
    applyTheme(r, "dark");
    applyTheme(r, "system");
    expect(r.attributes).toEqual({});
  });
});

describe("the pre-paint script in index.html", () => {
  it("reads the same storage key and the same two values as theme.ts", () => {
    expect(html).toContain(JSON.stringify(THEME_KEY));
    expect(html).toContain('"light"');
    expect(html).toContain('"dark"');
  });
});
